// Consistência entre schema.prisma e as migrations SQL.
//
// Por que este teste existe: a migration que vincula restaurante -> usuário
// foi escrita à mão, sem passar pelo `prisma migrate dev`. Escrever SQL à mão é
// exatamente onde nasce a divergência silenciosa — o schema diz uma coisa, o
// banco tem outra, e o erro só aparece em produção.
//
// O teste lê os dois arquivos, monta o "banco" que as migrations produzem e
// compara com o que o schema.prisma declara: tabelas, colunas, tipos,
// nulidade, índices únicos e chaves estrangeiras.
//
// Ele NÃO substitui a verificação contra um banco real (`npm run prisma:check`
// localmente; o job "banco" do CI faz o mesmo contra um PostgreSQL de verdade),
// mas roda em qualquer lugar, sem Docker e sem rede.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PRISMA_DIR = path.join(__dirname, "..", "prisma");

// ---------------------------------------------------------------- schema ----

function parseSchema() {
  const conteudo = fs.readFileSync(path.join(PRISMA_DIR, "schema.prisma"), "utf8");

  // Remove comentários de linha para não confundir o parser.
  const limpo = conteudo
    .split("\n")
    .map((linha) => linha.replace(/\/\/.*$/, ""))
    .join("\n");

  const modelos = {};
  const regexModelo = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;

  let encontrado;

  while ((encontrado = regexModelo.exec(limpo)) !== null) {
    const [, nome, corpo] = encontrado;

    const modelo = { nome, colunas: {}, unicos: [], indices: [], relacoes: [] };

    for (const linhaCrua of corpo.split("\n")) {
      const linha = linhaCrua.trim();

      if (!linha) continue;

      // Índice declarado no modelo: @@index([userId])
      const indice = linha.match(/^@@index\(\[([^\]]+)\]\)/);
      if (indice) {
        modelo.indices.push(indice[1].split(",").map((c) => c.trim()));
        continue;
      }

      if (linha.startsWith("@@")) continue;

      const campo = linha.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!campo) continue;

      const [, nomeCampo, tipo, lista, opcional, atributos] = campo;

      // Campo de relação (ex: user User?) e listas (Restaurant[]) não viram
      // coluna no banco — quem vira coluna é o campo escalar (userId).
      if (lista) continue;

      if (atributos.includes("@relation")) {
        const campos = atributos.match(/fields:\s*\[([^\]]+)\]/);
        const referencias = atributos.match(/references:\s*\[([^\]]+)\]/);
        const onDelete = atributos.match(/onDelete:\s*(\w+)/);

        if (campos && referencias) {
          modelo.relacoes.push({
            coluna: campos[1].trim(),
            tabelaDestino: tipo,
            colunaDestino: referencias[1].trim(),
            onDelete: onDelete ? onDelete[1] : "SetNull"
          });
        }
        continue;
      }

      const tiposEscalares = ["Int", "String", "Decimal", "Boolean", "DateTime", "Float", "BigInt"];
      if (!tiposEscalares.includes(tipo)) continue;

      const varchar = atributos.match(/@db\.VarChar\((\d+)\)/);
      const decimal = atributos.match(/@db\.Decimal\((\d+),\s*(\d+)\)/);

      let tipoSql;

      if (tipo === "Int") {
        tipoSql = atributos.includes("autoincrement()") ? "SERIAL" : "INTEGER";
      } else if (tipo === "String") {
        tipoSql = varchar ? `VARCHAR(${varchar[1]})` : "TEXT";
      } else if (tipo === "Decimal") {
        tipoSql = decimal ? `DECIMAL(${decimal[1]},${decimal[2]})` : "DECIMAL(65,30)";
      } else if (tipo === "Boolean") {
        tipoSql = "BOOLEAN";
      } else if (tipo === "DateTime") {
        tipoSql = "TIMESTAMP(3)";
      } else {
        tipoSql = tipo.toUpperCase();
      }

      modelo.colunas[nomeCampo] = {
        tipo: tipoSql,
        obrigatoria: !opcional,
        chavePrimaria: atributos.includes("@id")
      };

      if (atributos.includes("@unique")) {
        modelo.unicos.push(nomeCampo);
      }
    }

    modelos[nome] = modelo;
  }

  return modelos;
}

// ------------------------------------------------------------ migrations ----

function parseMigrations() {
  const dir = path.join(PRISMA_DIR, "migrations");

  const arquivos = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort() // a ordem cronológica está no nome da pasta
    .map((nome) => path.join(dir, nome, "migration.sql"));

  const sql = arquivos
    .map((arquivo) => fs.readFileSync(arquivo, "utf8"))
    .join("\n")
    .split("\n")
    .map((linha) => linha.replace(/--.*$/, ""))
    .join("\n");

  const tabelas = {};
  const unicos = [];
  const indices = [];
  const chavesEstrangeiras = [];

  // CREATE TABLE "X" ( ... );
  const regexCreate = /CREATE TABLE "(\w+)"\s*\(([\s\S]*?)\n\);/g;
  let encontrado;

  while ((encontrado = regexCreate.exec(sql)) !== null) {
    const [, tabela, corpo] = encontrado;
    tabelas[tabela] = {};

    for (const linhaCrua of corpo.split("\n")) {
      const linha = linhaCrua.trim().replace(/,$/, "");

      if (!linha || linha.startsWith("CONSTRAINT")) continue;

      const coluna = linha.match(/^"(\w+)"\s+([A-Z0-9()\s,]+?)(\s+NOT NULL)?$/i);
      if (!coluna) continue;

      const [, nome, tipo, notNull] = coluna;

      tabelas[tabela][nome] = {
        tipo: tipo.replace(/\s+/g, "").toUpperCase(),
        obrigatoria: Boolean(notNull)
      };
    }
  }

  // ALTER TABLE "X" ADD COLUMN "y" TIPO [NOT NULL];
  const regexAddColumn = /ALTER TABLE "(\w+)" ADD COLUMN\s+"(\w+)"\s+([A-Z0-9()\s,]+?)(\s+NOT NULL)?;/gi;

  while ((encontrado = regexAddColumn.exec(sql)) !== null) {
    const [, tabela, coluna, tipo, notNull] = encontrado;
    tabelas[tabela] = tabelas[tabela] ?? {};
    tabelas[tabela][coluna] = {
      tipo: tipo.replace(/\s+/g, "").toUpperCase(),
      obrigatoria: Boolean(notNull)
    };
  }

  // CREATE [UNIQUE] INDEX "..." ON "X"("col");
  const regexIndice = /CREATE (UNIQUE )?INDEX "[\w]+" ON "(\w+)"\s*\(([^)]+)\)/gi;

  while ((encontrado = regexIndice.exec(sql)) !== null) {
    const [, unico, tabela, colunas] = encontrado;
    const lista = colunas.split(",").map((c) => c.trim().replace(/"/g, ""));

    (unico ? unicos : indices).push({ tabela, colunas: lista });
  }

  // ALTER TABLE "X" ADD CONSTRAINT "..." FOREIGN KEY ("col") REFERENCES "Y"("id") ON DELETE ... ON UPDATE ...;
  const regexFk =
    /ALTER TABLE "(\w+)" ADD CONSTRAINT "[\w]+" FOREIGN KEY \("(\w+)"\) REFERENCES "(\w+)"\("(\w+)"\)\s*ON DELETE ([A-Z ]+?)\s*ON UPDATE ([A-Z ]+?);/gi;

  while ((encontrado = regexFk.exec(sql)) !== null) {
    const [, tabela, coluna, tabelaDestino, colunaDestino, onDelete, onUpdate] = encontrado;

    chavesEstrangeiras.push({
      tabela,
      coluna,
      tabelaDestino,
      colunaDestino,
      onDelete: onDelete.trim().toUpperCase(),
      onUpdate: onUpdate.trim().toUpperCase()
    });
  }

  return { tabelas, unicos, indices, chavesEstrangeiras };
}

// ----------------------------------------------------------------- testes ---

const schema = parseSchema();
const migrations = parseMigrations();

test("o parser encontrou os modelos e as tabelas esperadas", () => {
  // Protege contra um parser quebrado passar despercebido "sem achar nada".
  assert.deepEqual(Object.keys(schema).sort(), ["Restaurant", "User"]);
  assert.deepEqual(Object.keys(migrations.tabelas).sort(), ["Restaurant", "User"]);
});

test("cada modelo do schema tem uma tabela correspondente nas migrations", () => {
  for (const nome of Object.keys(schema)) {
    assert.ok(migrations.tabelas[nome], `falta CREATE TABLE para o modelo ${nome}`);
  }

  for (const nome of Object.keys(migrations.tabelas)) {
    assert.ok(schema[nome], `a tabela ${nome} existe nas migrations mas não no schema`);
  }
});

test("as colunas de cada tabela batem com os campos do schema", () => {
  for (const [nome, modelo] of Object.entries(schema)) {
    const doSchema = Object.keys(modelo.colunas).sort();
    const daMigration = Object.keys(migrations.tabelas[nome]).sort();

    assert.deepEqual(
      daMigration,
      doSchema,
      `as colunas de ${nome} divergem entre schema.prisma e as migrations`
    );
  }
});

test("os tipos SQL batem com os tipos declarados no schema", () => {
  for (const [nome, modelo] of Object.entries(schema)) {
    for (const [coluna, definicao] of Object.entries(modelo.colunas)) {
      const naMigration = migrations.tabelas[nome][coluna];

      assert.equal(
        naMigration.tipo,
        definicao.tipo,
        `${nome}.${coluna}: schema diz ${definicao.tipo}, migration diz ${naMigration.tipo}`
      );
    }
  }
});

test("a nulidade bate: campo obrigatório no schema é NOT NULL no banco", () => {
  for (const [nome, modelo] of Object.entries(schema)) {
    for (const [coluna, definicao] of Object.entries(modelo.colunas)) {
      const naMigration = migrations.tabelas[nome][coluna];

      // SERIAL de chave primária é NOT NULL por definição.
      if (definicao.tipo === "SERIAL") continue;

      assert.equal(
        naMigration.obrigatoria,
        definicao.obrigatoria,
        `${nome}.${coluna}: obrigatório no schema = ${definicao.obrigatoria}, ` +
          `NOT NULL na migration = ${naMigration.obrigatoria}`
      );
    }
  }
});

test("todo campo @unique tem um índice único na migration", () => {
  for (const [nome, modelo] of Object.entries(schema)) {
    for (const coluna of modelo.unicos) {
      const existe = migrations.unicos.some(
        (indice) => indice.tabela === nome && indice.colunas.includes(coluna)
      );

      assert.ok(existe, `falta CREATE UNIQUE INDEX para ${nome}.${coluna}`);
    }
  }
});

test("todo @@index do schema tem um índice na migration", () => {
  for (const [nome, modelo] of Object.entries(schema)) {
    for (const colunas of modelo.indices) {
      const existe = migrations.indices.some(
        (indice) =>
          indice.tabela === nome &&
          colunas.every((coluna) => indice.colunas.includes(coluna))
      );

      assert.ok(existe, `falta CREATE INDEX para ${nome}(${colunas.join(", ")})`);
    }
  }
});

test("toda relação do schema tem a chave estrangeira correspondente", () => {
  const traducaoOnDelete = {
    SetNull: "SET NULL",
    Cascade: "CASCADE",
    Restrict: "RESTRICT",
    NoAction: "NO ACTION"
  };

  for (const [nome, modelo] of Object.entries(schema)) {
    for (const relacao of modelo.relacoes) {
      const fk = migrations.chavesEstrangeiras.find(
        (candidata) => candidata.tabela === nome && candidata.coluna === relacao.coluna
      );

      assert.ok(fk, `falta FOREIGN KEY para ${nome}.${relacao.coluna}`);
      assert.equal(fk.tabelaDestino, relacao.tabelaDestino);
      assert.equal(fk.colunaDestino, relacao.colunaDestino);
      assert.equal(
        fk.onDelete,
        traducaoOnDelete[relacao.onDelete],
        `${nome}.${relacao.coluna}: onDelete do schema (${relacao.onDelete}) ` +
          `não corresponde ao ON DELETE da migration (${fk.onDelete})`
      );
    }
  }
});

test("a coluna userId de Restaurant é opcional (migration segura em banco com dados)", () => {
  // Uma coluna NOT NULL adicionada a uma tabela que já tem linhas faria a
  // migration falhar em qualquer banco existente.
  assert.equal(schema.Restaurant.colunas.userId.obrigatoria, false);
  assert.equal(migrations.tabelas.Restaurant.userId.obrigatoria, false);
});

test("o provider do migration_lock.toml é o mesmo do datasource (ADR-002)", () => {
  const lock = fs.readFileSync(path.join(PRISMA_DIR, "migrations", "migration_lock.toml"), "utf8");
  const schemaTexto = fs.readFileSync(path.join(PRISMA_DIR, "schema.prisma"), "utf8");

  assert.match(lock, /provider\s*=\s*"postgresql"/);
  assert.match(schemaTexto, /provider\s*=\s*"postgresql"/);
});
