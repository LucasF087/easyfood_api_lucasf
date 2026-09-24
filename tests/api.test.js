// Robustez da API: toda resposta de erro sai em JSON, sem vazar detalhe técnico.
//
// O padrão do Express seria:
//   - POST sem body -> 500 em HTML com stack trace
//   - JSON malformado -> a mesma página de erro em HTML
//   - rota inexistente -> 404 em HTML
//   - header X-Powered-By: Express em todas as respostas

const test = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, createClient } = require("./helpers/server");

let server;
let request;

test.before(async () => {
  server = await startTestServer();
  request = createClient(server.baseUrl);
});

test.after(async () => {
  await server.close();
});

test("GET / serve a interface web", async () => {
  const response = await request("/");

  assert.equal(response.status, 200);
  assert.match(response.contentType, /text\/html/);
});

test("GET /health responde 200 com status ok, sem tocar no banco", async () => {
  const response = await request("/health");

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(typeof response.body.uptime, "number");
  assert.equal(typeof response.body.timestamp, "string");
});

test("o header X-Powered-By não é enviado em nenhuma resposta", async () => {
  // Checagem automatizada: a correção não pode depender de inspeção visual.
  const paths = ["/", "/health", "/restaurants", "/rota-que-nao-existe"];

  for (const path of paths) {
    const response = await request(path);
    assert.equal(
      response.headers.get("x-powered-by"),
      null,
      `X-Powered-By veio preenchido em ${path}`
    );
  }
});

test("os cabeçalhos de segurança do helmet estão presentes", async () => {
  const response = await request("/");

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'self'/
  );
});

test("rota inexistente devolve 404 em JSON, não em HTML", async () => {
  const response = await request("/rota-que-nao-existe");

  assert.equal(response.status, 404);
  assert.match(response.contentType, /application\/json/);
  assert.equal(response.body.error, "Rota não encontrada");
  assert.equal(response.body.method, "GET");
});

test("POST sem body devolve 400 em JSON, não 500 em HTML", async () => {
  const response = await request("/auth/register", { method: "POST" });

  assert.equal(response.status, 400);
  assert.match(response.contentType, /application\/json/);
  assert.equal(response.body.error, "Dados inválidos");
  assert.ok(Array.isArray(response.body.details));
});

test("POST com JSON malformado devolve 400 em JSON, sem stack trace", async () => {
  const response = await request("/auth/login", {
    method: "POST",
    raw: '{"email": "ana@x.com", "password":'
  });

  assert.equal(response.status, 400);
  assert.match(response.contentType, /application\/json/);
  assert.equal(response.body.error, "JSON inválido no corpo da requisição");
});

test("nenhuma resposta de erro vaza caminho de arquivo ou stack trace", async () => {
  const responses = await Promise.all([
    request("/rota-que-nao-existe"),
    request("/auth/register", { method: "POST" }),
    request("/auth/login", { method: "POST", raw: "{" }),
    request("/restaurants/abc"),
    request("/restaurants/999999")
  ]);

  for (const response of responses) {
    assert.doesNotMatch(response.text, /\/home\/|\/usr\/|node_modules|C:\\\\/);
    assert.doesNotMatch(response.text, /at [\w.]+ \(/); // formato de stack
    assert.doesNotMatch(response.text, /<html/i);
  }
});

test("corpo acima do limite de 100kb devolve 413 em JSON", async () => {
  const response = await request("/auth/register", {
    method: "POST",
    raw: JSON.stringify({ name: "a".repeat(200 * 1024) })
  });

  assert.equal(response.status, 413);
  assert.equal(response.body.error, "Corpo da requisição acima do limite permitido");
});

test("Content-Type não suportado devolve 415 em JSON", async () => {
  const response = await request("/auth/login", {
    method: "POST",
    raw: "email=ana@x.com&password=123456",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  assert.equal(response.status, 415);
  assert.match(response.body.error, /application\/json/);
});

test("erro inesperado do banco vira 500 genérico, com o detalhe só no log", async () => {
  server.prisma.__failNextWith(new Error("connection reset by peer"));

  const response = await request("/restaurants");

  assert.equal(response.status, 500);
  assert.match(response.contentType, /application\/json/);
  assert.deepEqual(response.body, { error: "Erro interno do servidor" });
  assert.doesNotMatch(response.text, /connection reset/);
});

test("o stack trace do erro 500 vai para o log do servidor, nunca para o cliente", async () => {
  // Liga o log só neste teste e captura o que seria escrito no terminal.
  const anterior = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "error";

  const capturado = [];
  const consoleErrorOriginal = console.error;
  console.error = (...args) => capturado.push(args.join(" "));

  try {
    server.prisma.__failNextWith(new Error("segredo-que-nao-pode-vazar"));

    const response = await request("/restaurants");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: "Erro interno do servidor" });
    assert.doesNotMatch(response.text, /segredo-que-nao-pode-vazar/);

    const log = capturado.join("\n");
    assert.match(log, /segredo-que-nao-pode-vazar/);
    assert.match(log, /stack/);
  } finally {
    console.error = consoleErrorOriginal;
    process.env.LOG_LEVEL = anterior;
  }
});
