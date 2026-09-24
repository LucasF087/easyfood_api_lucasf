// CORS: quem pode chamar a API a partir de outro site.
//
// Cada teste sobe o seu próprio servidor, porque a configuração vem de
// variáveis de ambiente lidas no carregamento (ver helpers/server.js).

const test = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, createClient } = require("./helpers/server");

async function comAmbiente(env, fn) {
  const server = await startTestServer({ env });

  try {
    await fn(createClient(server.baseUrl));
  } finally {
    await server.close();
  }
}

test("fora de produção, sem CORS_ORIGIN, qualquer origem é aceita", async () => {
  await comAmbiente({ NODE_ENV: "development", CORS_ORIGIN: "" }, async (request) => {
    const response = await request("/health", { headers: { Origin: "https://qualquer.exemplo" } });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});

test("em produção, sem CORS_ORIGIN, nenhum cabeçalho CORS é enviado", async () => {
  await comAmbiente({ NODE_ENV: "production", CORS_ORIGIN: "" }, async (request) => {
    const response = await request("/health", { headers: { Origin: "https://qualquer.exemplo" } });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("com CORS_ORIGIN em lista, só as origens listadas são aceitas", async () => {
  await comAmbiente(
    {
      NODE_ENV: "production",
      CORS_ORIGIN: "https://easyfood.exemplo.com,https://admin.exemplo.com"
    },
    async (request) => {
      const permitida = await request("/health", {
        headers: { Origin: "https://admin.exemplo.com" }
      });
      assert.equal(
        permitida.headers.get("access-control-allow-origin"),
        "https://admin.exemplo.com"
      );

      const negada = await request("/health", {
        headers: { Origin: "https://invasor.exemplo.com" }
      });
      assert.equal(negada.status, 200);
      assert.equal(negada.headers.get("access-control-allow-origin"), null);
    }
  );
});
