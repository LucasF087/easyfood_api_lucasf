// Autenticação por cookie httpOnly + defesa CSRF (ADR-006).
//
// Diferente de auth.test.js (que usa sempre Authorization: Bearer), aqui os
// testes simulam o front-end: pegam os cookies devolvidos no login e os
// reenviam manualmente (o fetch nativo não tem cookie jar entre chamadas
// separadas, ao contrário de um navegador de verdade).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  createClient,
  cookieValue,
  cookieHeader
} = require("./helpers/server");

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

const conta = { name: "Aluno", email: "cookie@easyfood.com", password: "senha123" };

// Loga e devolve { cookies, csrf, user } prontos para reusar nos testes.
async function login() {
  await request("/auth/register", { method: "POST", body: conta });

  const response = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: conta.password }
  });

  const token = cookieValue(response, "easyfood_token");
  const csrf = cookieValue(response, "easyfood_csrf");

  return {
    response,
    csrf,
    cookies: cookieHeader({ easyfood_token: token, easyfood_csrf: csrf })
  };
}

test("login grava easyfood_token (httpOnly) e easyfood_csrf (legível)", async () => {
  const { response } = await login();

  const setCookies = response.headers.getSetCookie();
  const tokenCookie = setCookies.find((c) => c.startsWith("easyfood_token="));
  const csrfCookie = setCookies.find((c) => c.startsWith("easyfood_csrf="));

  assert.ok(tokenCookie, "deveria gravar o cookie do token");
  assert.match(tokenCookie, /HttpOnly/i);
  assert.match(tokenCookie, /SameSite=Lax/i);

  assert.ok(csrfCookie, "deveria gravar o cookie CSRF");
  assert.doesNotMatch(csrfCookie, /HttpOnly/i);

  // Em desenvolvimento (NODE_ENV=test aqui) o cookie não é "secure": não há
  // HTTPS local. Ver COOKIE_SECURE em src/config/env.js.
  assert.doesNotMatch(tokenCookie, /Secure/i);
});

test("GET /auth/me autentica só com o cookie, sem Authorization", async () => {
  const { cookies } = await login();

  const response = await request("/auth/me", {
    headers: { Cookie: cookies }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, conta.email);
});

test("POST /restaurants via cookie SEM X-CSRF-Token é recusado (403)", async () => {
  const { cookies } = await login();

  const response = await request("/restaurants", {
    method: "POST",
    headers: { Cookie: cookies },
    body: { name: "Sem CSRF", category: "Pizza", rating: 4 }
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Token CSRF ausente ou inválido");
});

test("POST /restaurants via cookie COM X-CSRF-Token correto funciona", async () => {
  const { cookies, csrf } = await login();

  const response = await request("/restaurants", {
    method: "POST",
    headers: { Cookie: cookies, "X-CSRF-Token": csrf },
    body: { name: "Com CSRF", category: "Pizza", rating: 4 }
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.name, "Com CSRF");
});

test("X-CSRF-Token que não bate com o cookie é recusado (403)", async () => {
  const { cookies } = await login();

  const response = await request("/restaurants", {
    method: "POST",
    headers: { Cookie: cookies, "X-CSRF-Token": "valor-forjado-por-outro-site" },
    body: { name: "Forjado", category: "Pizza", rating: 4 }
  });

  assert.equal(response.status, 403);
});

test("Authorization: Bearer continua funcionando sem X-CSRF-Token (não é ambiente)", async () => {
  await request("/auth/register", { method: "POST", body: conta });

  const loginResponse = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: conta.password }
  });

  const response = await request("/restaurants", {
    method: "POST",
    token: loginResponse.body.token,
    body: { name: "Via Bearer", category: "Sushi", rating: 5 }
  });

  assert.equal(response.status, 201);
});

test("POST /auth/logout apaga os dois cookies", async () => {
  const response = await request("/auth/logout", { method: "POST" });

  assert.equal(response.status, 204);

  const setCookies = response.headers.getSetCookie();
  const tokenCookie = setCookies.find((c) => c.startsWith("easyfood_token="));
  const csrfCookie = setCookies.find((c) => c.startsWith("easyfood_csrf="));

  // Express apaga um cookie mandando o mesmo nome com valor vazio e data no
  // passado (Expires=Thu, 01 Jan 1970).
  assert.ok(tokenCookie);
  assert.match(tokenCookie, /Expires=Thu, 01 Jan 1970/);
  assert.ok(csrfCookie);
  assert.match(csrfCookie, /Expires=Thu, 01 Jan 1970/);
});

test("depois do logout, uma chamada sem o cookie não autentica (401)", async () => {
  // O logout apaga o cookie no navegador (teste acima). Aqui simulamos
  // exatamente isso: nenhum cookie é reenviado, como aconteceria numa aba
  // real depois do logout.
  //
  // Observação: como o JWT continua sendo stateless (ADR-004), o VALOR do
  // token em si não é invalidado no servidor — só o cookie que o guardava é
  // apagado. Se alguém tivesse copiado o valor do token antes do logout, ele
  // seguiria válido até a expiração. Revogação individual de token é um item
  // de "Critérios de revisão" tanto na ADR-004 quanto na ADR-006.
  await request("/auth/logout", { method: "POST" });

  const semCookie = await request("/auth/me");
  assert.equal(semCookie.status, 401);
});
