// Documentação OpenAPI (swagger-jsdoc + swagger-ui-express).
//
// Não testa o conteúdo visual da página (isso é responsabilidade da
// biblioteca swagger-ui-express, já testada por ela mesma) — só garante que
// a especificação foi gerada corretamente a partir dos comentários
// @openapi nas rotas, e que ela pode ser desligada por variável de ambiente.

const test = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, createClient } = require("./helpers/server");

test("GET /docs.json devolve uma especificação OpenAPI 3 com as rotas principais", async () => {
  const server = await startTestServer();
  const request = createClient(server.baseUrl);

  try {
    const response = await request("/docs.json");

    assert.equal(response.status, 200);
    assert.match(response.contentType, /application\/json/);
    assert.equal(response.body.openapi, "3.0.3");

    const paths = Object.keys(response.body.paths);
    for (const rota of ["/auth/login", "/auth/logout", "/auth/me", "/restaurants", "/restaurants/{id}", "/health"]) {
      assert.ok(paths.includes(rota), `esperava ${rota} na especificação`);
    }
  } finally {
    await server.close();
  }
});

test("GET /docs responde com a página do Swagger UI", async () => {
  const server = await startTestServer();
  const request = createClient(server.baseUrl);

  try {
    const response = await request("/docs/");

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
  } finally {
    await server.close();
  }
});

test("API_DOCS_ENABLED=false desliga /docs e /docs.json (404)", async () => {
  const server = await startTestServer({ env: { API_DOCS_ENABLED: "false" } });
  const request = createClient(server.baseUrl);

  try {
    const spec = await request("/docs.json");
    assert.equal(spec.status, 404);

    const ui = await request("/docs/");
    assert.equal(ui.status, 404);
  } finally {
    await server.close();
  }
});
