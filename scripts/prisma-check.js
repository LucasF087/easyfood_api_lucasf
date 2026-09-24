#!/usr/bin/env node
// scripts/prisma-check.js
//
// Compara as migrations com o schema.prisma usando um banco "sombra"
// temporário — a verificação mencionada no README como complemento ao
// tests/schema.test.js.
//
// Por que este arquivo existe: a primeira versão do comando ficava direto
// no package.json e lia a variável de ambiente com a sintaxe do Bash
// ("$SHADOW_DATABASE_URL"). No Windows, o npm roda os scripts pelo cmd.exe
// por padrão, que usa "%VARIAVEL%" — o Bash nunca interpretava o valor, e o
// Prisma recebia a string literal "$SHADOW_DATABASE_URL" como URL de banco.
// Ler a variável aqui, em JavaScript, funciona igual em qualquer sistema
// operacional.

const { spawnSync } = require("node:child_process");

const shadowUrl = process.env.SHADOW_DATABASE_URL;

if (!shadowUrl) {
  console.error(
    "\n[prisma:check] Defina SHADOW_DATABASE_URL antes de rodar este comando.\n" +
      "Precisa ser um banco PostgreSQL vazio e descartável — NUNCA o banco de desenvolvimento,\n" +
      "porque o Prisma aplica e desfaz migrations nele.\n\n" +
      "  PowerShell (Windows):\n" +
      '    $env:SHADOW_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/easyfood_shadow"\n' +
      "    npm run prisma:check\n\n" +
      "  Bash (Linux/macOS):\n" +
      '    SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/easyfood_shadow" npm run prisma:check\n'
  );
  process.exit(1);
}

const args = [
  "prisma",
  "migrate",
  "diff",
  "--from-migrations",
  "./prisma/migrations",
  "--to-schema-datamodel",
  "./prisma/schema.prisma",
  "--shadow-database-url",
  shadowUrl,
  "--exit-code"
];

// shell: true no Windows porque lá o npx é um .cmd, e o Node só encontra um
// .cmd através do shell. Em Linux/macOS o binário é encontrado direto, sem
// precisar de shell — e não precisar de shell evita reintroduzir o mesmo
// problema de interpretação que este arquivo existe para resolver.
const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) {
  console.error(`[prisma:check] Falha ao executar o Prisma: ${result.error.message}`);
  process.exit(1);
}

// --exit-code muda o significado dos códigos de saída do "migrate diff":
//   0 = sem diferença (schema e migrations batem)
//   1 = erro (ex.: não conseguiu conectar no banco sombra)
//   2 = diferença encontrada (schema e migrations divergem)
if (result.status === 0) {
  console.log("\n[prisma:check] OK — migrations e schema.prisma estão em sincronia.\n");
} else if (result.status === 2) {
  console.error(
    "\n[prisma:check] Divergência encontrada entre as migrations e o schema.prisma " +
      "(ver a comparação acima).\n"
  );
} else {
  console.error(`\n[prisma:check] O Prisma encerrou com erro (código ${result.status}).\n`);
}

process.exit(result.status ?? 1);
