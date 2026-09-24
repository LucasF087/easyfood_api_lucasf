// Inicialização: a aplicação precisa falhar rápido e com mensagem clara
// quando o ambiente está errado. Sem essa validação, a API subiria sem
// JWT_SECRET e só quebraria — com 500 e sem explicação — na primeira tentativa
// de login.
//
// Os testes rodam o `server.js` de verdade, em um processo separado, com
// cwd em uma pasta temporária: assim um arquivo .env do desenvolvedor não
// interfere no resultado.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const SERVER = path.join(RAIZ, "server.js");

const SEGREDO_VALIDO =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// O Prisma Client só existe depois de `npx prisma generate`. Sem ele,
// `node server.js` não chega a escutar a porta — então o teste de boot
// completo é pulado, com aviso, em vez de falhar por um motivo que não tem
// relação com o que está sendo verificado.
function prismaClientGerado() {
  try {
    const { PrismaClient } = require("@prisma/client");
    new PrismaClient();
    return true;
  } catch {
    return false;
  }
}

const PRISMA_PRONTO = prismaClientGerado();

function rodarServidor(env = {}, { esperarPorta = false } = {}) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [SERVER], {
      // Pasta temporária: garante que nenhum .env local seja carregado.
      cwd: os.tmpdir(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        ...env
      }
    });

    let stdout = "";
    let stderr = "";

    filho.stdout.on("data", (chunk) => {
      stdout += chunk;

      if (esperarPorta && stdout.includes("rodando na porta")) {
        resolve({ filho, stdout, stderr, code: null });
      }
    });

    filho.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    filho.on("close", (code) => {
      resolve({ filho: null, stdout, stderr, code });
    });
  });
}

test("sem JWT_SECRET, o servidor não sobe e explica o motivo", async () => {
  const { code, stderr } = await rodarServidor({});

  assert.equal(code, 1, "o processo deveria encerrar com código 1");
  assert.match(stderr, /JWT_SECRET/);
  assert.match(stderr, /obrigatória/);
  assert.match(stderr, /\.env\.example/);
});

test("a falha de ambiente não imprime stack trace", async () => {
  const { stderr } = await rodarServidor({});

  // A mensagem é para uma pessoa resolver o problema, não um dump do Node.
  assert.doesNotMatch(stderr, /at .+\(.+:\d+:\d+\)/);
  assert.doesNotMatch(stderr, /node_modules/);
});

test("com JWT_SECRET curto demais, o servidor não sobe", async () => {
  const { code, stderr } = await rodarServidor({ JWT_SECRET: "curto-demais" });

  assert.equal(code, 1);
  assert.match(stderr, /pelo menos 32 bytes/);
  assert.match(stderr, /randomBytes/); // sugere como gerar um segredo bom
});

test("JWT_SECRET com exatamente 32 bytes é aceito pela validação", async () => {
  // Valida só a camada de configuração (não sobe o servidor, não usa Prisma).
  const { code, stdout } = await new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      ["-e", `require(${JSON.stringify(path.join(RAIZ, "src/config/env.js"))}); console.log("config-ok");`],
      {
        cwd: os.tmpdir(),
        env: { PATH: process.env.PATH, JWT_SECRET: "a".repeat(32) }
      }
    );

    let stdout = "";
    filho.stdout.on("data", (chunk) => (stdout += chunk));
    filho.on("close", (code) => resolve({ code, stdout }));
  });

  assert.equal(code, 0);
  assert.match(stdout, /config-ok/);
});

test(
  "com ambiente válido, o servidor sobe e responde em /health",
  { skip: PRISMA_PRONTO ? false : "requer `npx prisma generate` (Prisma Client não gerado)" },
  async (t) => {
    const porta = 3100 + Math.floor(Math.random() * 500);

    const { filho } = await rodarServidor(
      { JWT_SECRET: SEGREDO_VALIDO, PORT: String(porta) },
      { esperarPorta: true }
    );

    t.after(() => filho?.kill());

    const resposta = await fetch(`http://127.0.0.1:${porta}/health`);
    const corpo = await resposta.json();

    assert.equal(resposta.status, 200);
    assert.equal(corpo.status, "ok");
    assert.equal(resposta.headers.get("x-powered-by"), null);
  }
);

// ---------------------------------------------------------------------------
// TRUST_PROXY e CORS_ORIGIN
// ---------------------------------------------------------------------------

// Carrega só a camada de configuração (sem servidor e sem Prisma) e devolve
// o que ela resolveu para trustProxy e cors.
function lerConfig(env = {}) {
  return new Promise((resolve) => {
    const script =
      `const c = require(${JSON.stringify(path.join(RAIZ, "src/config/env.js"))});` +
      "console.log(JSON.stringify({ trustProxy: c.trustProxy, cors: c.cors }));";

    const filho = spawn(process.execPath, ["-e", script], {
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH, JWT_SECRET: "a".repeat(32), ...env }
    });

    let stdout = "";
    let stderr = "";

    filho.stdout.on("data", (chunk) => (stdout += chunk));
    filho.stderr.on("data", (chunk) => (stderr += chunk));

    filho.on("close", (code) => {
      resolve({ code, stderr, config: code === 0 ? JSON.parse(stdout) : null });
    });
  });
}

test("TRUST_PROXY: vazio, 0 e false não confiam em proxy; número vira a quantidade de proxies", async () => {
  const casos = [
    [{}, false],
    [{ TRUST_PROXY: "" }, false],
    [{ TRUST_PROXY: "0" }, false],
    [{ TRUST_PROXY: "false" }, false],
    [{ TRUST_PROXY: "1" }, 1],
    [{ TRUST_PROXY: "2" }, 2],
    [{ TRUST_PROXY: "loopback, 10.0.0.0/8" }, "loopback, 10.0.0.0/8"]
  ];

  for (const [env, esperado] of casos) {
    const { code, config } = await lerConfig(env);

    assert.equal(code, 0, `ambiente ${JSON.stringify(env)} deveria ser aceito`);
    assert.deepEqual(config.trustProxy, esperado, `ambiente ${JSON.stringify(env)}`);
  }
});

test("TRUST_PROXY=true é recusado, porque o cliente poderia forjar o próprio IP", async () => {
  const { code, stderr } = await lerConfig({ TRUST_PROXY: "true" });

  assert.equal(code, 1);
  assert.match(stderr, /TRUST_PROXY=true não é aceito/);
  assert.match(stderr, /X-Forwarded-For/);
});

test("CORS_ORIGIN: o padrão libera tudo fora de produção e nada em produção", async () => {
  const dev = await lerConfig({});
  assert.equal(dev.config.cors.origin, "*");

  const explicitoDev = await lerConfig({ NODE_ENV: "development" });
  assert.equal(explicitoDev.config.cors.origin, "*");

  const producao = await lerConfig({ NODE_ENV: "production" });
  assert.equal(producao.config.cors.origin, false);
});

test("CORS_ORIGIN aceita * e uma lista de origens separadas por vírgula", async () => {
  const todas = await lerConfig({ NODE_ENV: "production", CORS_ORIGIN: "*" });
  assert.equal(todas.config.cors.origin, "*");

  const lista = await lerConfig({
    NODE_ENV: "production",
    CORS_ORIGIN: "https://easyfood.exemplo.com, http://localhost:5173"
  });
  assert.deepEqual(lista.config.cors.origin, [
    "https://easyfood.exemplo.com",
    "http://localhost:5173"
  ]);
});

test("CORS_ORIGIN com valor inválido faz o servidor se recusar a subir", async () => {
  for (const invalido of ["https://easyfood.exemplo.com/", "easyfood.exemplo.com", "ftp://x.com"]) {
    const { code, stderr } = await lerConfig({ CORS_ORIGIN: invalido });

    assert.equal(code, 1, `"${invalido}" deveria ser recusado`);
    assert.match(stderr, /CORS_ORIGIN contém um valor inválido/);
  }
});
