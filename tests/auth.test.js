// Autenticação: validação de entrada, bcrypt e JWT de verdade.
//
// Só o acesso ao banco é dublê. O hash da senha, a assinatura e a validação
// do token são executados pelas bibliotecas reais.

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const { startTestServer, createClient, TEST_JWT_SECRET } = require("./helpers/server");

// Garante que a assinatura utiliza o segredo do GitHub Actions ou o fallback local
const SECRET = process.env.JWT_SECRET || TEST_JWT_SECRET;

let server;
let request;

test.before(async () => {
  server = await startTestServer();
  request = createClient(server.baseUrl);
});

test.beforeEach(() => {
  server.prisma.__reset();
});

test.after(async () => {
  await server.close();
});

const conta = { name: "Aluno", email: "aluno@easyfood.com", password: "senha123" };

test("POST /auth/register cria o usuário e nunca devolve a senha", async () => {
  const response = await request("/auth/register", { method: "POST", body: conta });

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body).sort(), ["email", "id", "name"]);
  assert.equal(response.body.email, "aluno@easyfood.com");
  assert.equal(response.body.password, undefined);
});

test("a senha é gravada como hash bcrypt, nunca em texto puro", async () => {
  await request("/auth/register", { method: "POST", body: conta });

  const gravado = server.prisma.__state.users[0];

  assert.notEqual(gravado.password, conta.password);
  assert.match(gravado.password, /^\$2[aby]\$\d{2}\$/);
});

test("e-mail é normalizado: Ana@X.com e ana@x.com são a mesma conta", async () => {
  const criada = await request("/auth/register", {
    method: "POST",
    body: { ...conta, email: "  Ana@X.com  " }
  });

  assert.equal(criada.status, 201);
  assert.equal(criada.body.email, "ana@x.com");

  // Mesma pessoa, digitação diferente: precisa dar conflito, não conta nova.
  const duplicada = await request("/auth/register", {
    method: "POST",
    body: { ...conta, email: "ana@x.com" }
  });

  assert.equal(duplicada.status, 409);
  assert.equal(duplicada.body.error, "E-mail já cadastrado");

  // E o login precisa funcionar com qualquer uma das grafias.
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: "ANA@x.com", password: conta.password }
  });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, "ana@x.com");
});

test("e-mail em formato inválido é recusado com 400", async () => {
  const invalidos = ["ana", "ana@", "@x.com", "ana@x", "ana com@x.com", "ana@@x.com"];

  for (const email of invalidos) {
    const response = await request("/auth/register", {
      method: "POST",
      body: { ...conta, email }
    });

    assert.equal(response.status, 400, `"${email}" deveria ser recusado`);
    assert.ok(response.body.details.includes("E-mail em formato inválido"));
  }
});

test("senha com menos de 6 caracteres é recusada", async () => {
  const response = await request("/auth/register", {
    method: "POST",
    body: { ...conta, password: "12345" }
  });

  assert.equal(response.status, 400);
  assert.ok(response.body.details.some((d) => d.includes("pelo menos 6")));
});

test("senha acima de 72 bytes é recusada (limite do bcrypt)", async () => {
  // 73 caracteres ASCII = 73 bytes.
  const longa = "a".repeat(73);

  const response = await request("/auth/register", {
    method: "POST",
    body: { ...conta, password: longa }
  });

  assert.equal(response.status, 400);
  assert.ok(response.body.details.some((d) => d.includes("72 bytes")));
});

test("senha é contada em bytes, não em caracteres (acentos e emojis)", async () => {
  // 30 emojis de 4 bytes = 120 bytes, mesmo tendo só 60 unidades de código.
  const emojis = "🍕".repeat(30);

  const response = await request("/auth/register", {
    method: "POST",
    body: { ...conta, password: emojis }
  });

  assert.equal(response.status, 400);
  assert.ok(response.body.details.some((d) => d.includes("72 bytes")));
});

test("campos com tipo errado são recusados com 400, não com 500", async () => {
  const casos = [
    { ...conta, name: 42 },
    { ...conta, email: { $ne: null } },
    { ...conta, password: ["123456"] },
    { ...conta, password: 123456 },
    { name: null, email: null, password: null }
  ];

  for (const body of casos) {
    const response = await request("/auth/register", { method: "POST", body });
    assert.equal(response.status, 400, `corpo ${JSON.stringify(body)} deveria dar 400`);
  }
});

test("POST /auth/login devolve um token HS256 válido", async () => {
  await request("/auth/register", { method: "POST", body: conta });

  const response = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: conta.password }
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.token, "string");

  const payload = jwt.verify(response.body.token, SECRET, {
    algorithms: ["HS256"]
  });

  assert.equal(payload.email, conta.email);
  assert.equal(Number(payload.sub), response.body.user.id);

  const header = JSON.parse(
    Buffer.from(response.body.token.split(".")[0], "base64url").toString("utf8")
  );
  assert.equal(header.alg, "HS256");
});

test("senha errada devolve 401 mesmo quando é curta demais para ser uma senha válida", async () => {
  await request("/auth/register", { method: "POST", body: conta });

  // As regras de tamanho valem no cadastro. No login, uma senha errada é sempre
  // 401 — 400 revelaria a política de senha.
  const curta = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: "12345" }
  });

  assert.equal(curta.status, 401);
  assert.deepEqual(curta.body, { error: "Credenciais inválidas" });
});

test("conta criada com senha curta (antes da regra de tamanho) ainda consegue entrar", async () => {
  const bcrypt = require("bcryptjs");

  server.prisma.__seed({
    users: [
      {
        name: "Conta antiga",
        email: "antiga@easyfood.com",
        password: await bcrypt.hash("123", 4)
      }
    ]
  });

  const response = await request("/auth/login", {
    method: "POST",
    body: { email: "antiga@easyfood.com", password: "123" }
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.token, "string");
});

test("login sem senha ou com senha que não é texto devolve 400", async () => {
  for (const password of [undefined, "", null, 123456, ["123456"]]) {
    const response = await request("/auth/login", {
      method: "POST",
      body: { email: conta.email, password }
    });

    assert.equal(response.status, 400, `senha ${JSON.stringify(password)} deveria dar 400`);
  }
});

test("senha errada e e-mail inexistente devolvem a mesma resposta 401", async () => {
  await request("/auth/register", { method: "POST", body: conta });

  const senhaErrada = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: "senha-errada" }
  });

  const naoExiste = await request("/auth/login", {
    method: "POST",
    body: { email: "ninguem@easyfood.com", password: "senha-errada" }
  });

  assert.equal(senhaErrada.status, 401);
  assert.equal(naoExiste.status, 401);
  assert.deepEqual(senhaErrada.body, naoExiste.body);
  assert.deepEqual(senhaErrada.body, { error: "Credenciais inválidas" });
});

test("GET /auth/me exige token e devolve o usuário autenticado", async () => {
  await request("/auth/register", { method: "POST", body: conta });
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: conta.password }
  });

  const semToken = await request("/auth/me");
  assert.equal(semToken.status, 401);
  assert.equal(semToken.body.error, "Token não fornecido");

  const comToken = await request("/auth/me", { token: login.body.token });
  assert.equal(comToken.status, 200);
  assert.equal(comToken.body.user.email, conta.email);
});

test("token inválido, expirado ou assinado com outro segredo é recusado", async () => {
  const lixo = await request("/auth/me", { token: "nao-e-um-token" });
  assert.equal(lixo.status, 401);

  const outroSegredo = jwt.sign({ sub: "1", email: conta.email }, "x".repeat(64), {
    algorithm: "HS256"
  });
  const comOutroSegredo = await request("/auth/me", { token: outroSegredo });
  assert.equal(comOutroSegredo.status, 401);

  const expirado = jwt.sign({ sub: "1", email: conta.email }, SECRET, {
    algorithm: "HS256",
    expiresIn: "-1s"
  });
  const comExpirado = await request("/auth/me", { token: expirado });
  assert.equal(comExpirado.status, 401);
  assert.equal(comExpirado.body.error, "Token expirado");
});

test('token com alg "none" é recusado (confusão de algoritmo)', async () => {
  // Monta à mão um token sem assinatura. Se o verify não fixasse
  // algorithms: ["HS256"], este é o tipo de token que pode passar.
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "1", email: conta.email })).toString("base64url");
  const forjado = `${header}.${payload}.`;

  const response = await request("/auth/me", { token: forjado });

  assert.equal(response.status, 401);
});