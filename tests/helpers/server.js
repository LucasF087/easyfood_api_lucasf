// Helper de teste: sobe a API de verdade, sem banco.
//
// O arquivo NÃO se chama test-*.js de propósito: o `node --test` trata esse
// padrão de nome como arquivo de teste e o executaria (e contaria) como se
// fosse um.
//
// Ordem obrigatória:
//   1. definir as variáveis de ambiente (config/env valida no require)
//   2. descartar os módulos de src/ já carregados (para a nova configuração
//      valer, quando o mesmo processo sobe mais de um servidor)
//   3. instalar o dublê do Prisma no require.cache
//   4. só então carregar src/app
//
// O servidor sobe na porta 0: o sistema operacional escolhe uma porta livre,
// então vários arquivos de teste podem rodar em paralelo sem conflito.

const path = require("node:path");

const { installPrismaStub } = require("./prisma-stub");

const SRC_DIR = path.join(__dirname, "..", "..", "src") + path.sep;

// Remove do require.cache tudo o que vem de src/. Sem isso, o config/env.js
// carregado pelo primeiro servidor seria reaproveitado pelos seguintes e as
// variáveis de ambiente novas (CORS_ORIGIN, TRUST_PROXY...) seriam ignoradas.
function clearProjectModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) {
      delete require.cache[key];
    }
  }
}

// Segredo só de teste, com 64 caracteres hexadecimais (32 bytes).
const TEST_JWT_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function setTestEnv(extra = {}) {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? TEST_JWT_SECRET;
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  // Rate limit e notificações ficam desligados por padrão para não poluir a
  // saída nem interferir em testes que fazem várias chamadas seguidas.
  // Os arquivos que testam essas duas coisas ligam explicitamente.
  process.env.RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED ?? "false";
  process.env.NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED ?? "false";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

  for (const [key, value] of Object.entries(extra)) {
    process.env[key] = value;
  }
}

async function startTestServer({ seed = {}, env = {} } = {}) {
  setTestEnv(env);
  clearProjectModules();

  const prisma = installPrismaStub(seed);

  // require depois do stub: o src/database/prisma.js real nunca é executado,
  // então nenhum PrismaClient é instanciado e nenhum banco é necessário.
  const app = require("../../src/app");

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    prisma,
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

// Pequeno wrapper em volta do fetch nativo (Node 18+): devolve status,
// headers, corpo cru e corpo já interpretado quando for JSON.
function createClient(baseUrl) {
  return async function request(path, options = {}) {
    const { token, body, raw, headers = {}, ...rest } = options;

    const finalHeaders = { ...headers };

    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }

    let payload;

    if (raw !== undefined) {
      payload = raw;
      finalHeaders["Content-Type"] = finalHeaders["Content-Type"] ?? "application/json";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      finalHeaders["Content-Type"] = finalHeaders["Content-Type"] ?? "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: payload
    });

    const text = await response.text();
    let json;

    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    return {
      status: response.status,
      headers: response.headers,
      contentType: response.headers.get("content-type") ?? "",
      text,
      body: json
    };
  };
}

// Extrai o valor de um cookie específico dos headers Set-Cookie de uma
// resposta (getSetCookie() existe no fetch nativo desde o Node 20).
function cookieValue(response, name) {
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const found = setCookies.find((line) => line.startsWith(`${name}=`));

  if (!found) return null;

  return found.split(";")[0].slice(name.length + 1);
}

// Monta o header Cookie a partir de um mapa { nome: valor }, para reenviar
// numa próxima requisição — o fetch nativo não tem cookie jar automático
// entre chamadas separadas como um navegador.
function cookieHeader(cookies) {
  return Object.entries(cookies)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

module.exports = { startTestServer, createClient, setTestEnv, TEST_JWT_SECRET, cookieValue, cookieHeader };
