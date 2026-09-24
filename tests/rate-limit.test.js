// Rate limit nas rotas de autenticação.
//
// Arquivo separado de propósito: o `node --test` roda cada arquivo em um
// processo próprio, então dá para ligar o limitador aqui (com um teto baixo)
// sem afetar os outros testes.

const test = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, createClient } = require("./helpers/server");

let server;
let request;

test.before(async () => {
  server = await startTestServer({
    env: {
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_MAX: "3",
      RATE_LIMIT_WINDOW_MS: "60000"
    }
  });

  request = createClient(server.baseUrl);
});

test.after(async () => {
  await server.close();
});

test("tentativas de login acima do limite recebem 429 em JSON", async () => {
  const tentativa = () =>
    request("/auth/login", {
      method: "POST",
      body: { email: "ana@easyfood.com", password: "senha-errada" }
    });

  // As 3 primeiras passam pelo limitador (e falham no login, com 401).
  for (let i = 1; i <= 3; i++) {
    const resposta = await tentativa();
    assert.equal(resposta.status, 401, `tentativa ${i} deveria ser 401`);
  }

  // A 4ª é barrada antes de chegar ao controller.
  const bloqueada = await tentativa();

  assert.equal(bloqueada.status, 429);
  assert.match(bloqueada.contentType, /application\/json/);
  assert.match(bloqueada.body.error, /Muitas tentativas/);
});

test("o rate limit não afeta as rotas públicas de restaurantes", async () => {
  for (let i = 0; i < 10; i++) {
    const resposta = await request("/restaurants");
    assert.equal(resposta.status, 200);
  }
});

// ---------------------------------------------------------------------------
// Atrás de um proxy reverso
// ---------------------------------------------------------------------------

// Um cliente por IP, todos passando por um proxy que preenche X-Forwarded-For.
function loginPeloProxy(client, ip) {
  return client("/auth/login", {
    method: "POST",
    body: { email: `${ip}@easyfood.com`, password: "senha-errada" },
    headers: { "X-Forwarded-For": ip }
  });
}

async function comServidor(env, fn) {
  const outro = await startTestServer({
    env: { RATE_LIMIT_ENABLED: "true", RATE_LIMIT_MAX: "3", RATE_LIMIT_WINDOW_MS: "60000", ...env }
  });

  try {
    await fn(createClient(outro.baseUrl));
  } finally {
    await outro.close();
  }
}

test("com TRUST_PROXY=1, cada IP do X-Forwarded-For tem o seu próprio contador", async () => {
  await comServidor({ TRUST_PROXY: "1" }, async (client) => {
    // Cinco clientes diferentes, uma tentativa cada: nenhum passa do limite de 3.
    for (let i = 1; i <= 5; i++) {
      const resposta = await loginPeloProxy(client, `203.0.113.${i}`);
      assert.equal(resposta.status, 401, `cliente ${i} não deveria ser bloqueado`);
    }

    // O mesmo cliente insistindo: a 4ª tentativa é barrada.
    for (let i = 1; i <= 2; i++) {
      assert.equal((await loginPeloProxy(client, "203.0.113.1")).status, 401);
    }
    assert.equal((await loginPeloProxy(client, "203.0.113.1")).status, 429);
  });
});

test("sem TRUST_PROXY, atrás de um proxy, todos os clientes dividem um contador só", async () => {
  // É o problema que TRUST_PROXY resolve. O express-rate-limit também avisa no
  // console.error; o aviso é silenciado aqui só para não poluir a saída.
  const original = console.error;
  console.error = () => {};

  try {
    await comServidor({ TRUST_PROXY: "" }, async (client) => {
      const status = [];

      for (let i = 1; i <= 5; i++) {
        status.push((await loginPeloProxy(client, `203.0.113.${i}`)).status);
      }

      assert.deepEqual(status, [401, 401, 401, 429, 429]);
    });
  } finally {
    console.error = original;
  }
});
