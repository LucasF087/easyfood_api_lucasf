// Restaurantes: rotas públicas, rotas protegidas, validação do rating e
// regra de posse (só o dono altera ou exclui).

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

async function criarUsuarioLogado(email) {
  const conta = { name: "Dono", email, password: "senha123" };

  await request("/auth/register", { method: "POST", body: conta });

  const login = await request("/auth/login", {
    method: "POST",
    body: { email: conta.email, password: conta.password }
  });

  return { token: login.body.token, id: login.body.user.id, email: conta.email };
}

test.beforeEach(() => {
  server.prisma.__reset({
    restaurants: [{ name: "Pizzaria Napoli", category: "Pizza", rating: 4.5 }]
  });
});

test("GET /restaurants é público e lista os restaurantes", async () => {
  const response = await request("/restaurants");

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].name, "Pizzaria Napoli");
});

test("a resposta traz exatamente os campos do schema do Prisma", async () => {
  const response = await request("/restaurants");

  // Se o schema mudar e o controller não acompanhar, este teste quebra.
  assert.deepEqual(Object.keys(response.body[0]).sort(), [
    "category",
    "id",
    "name",
    "rating",
    "userId"
  ]);
});

test("GET /restaurants/:id devolve um restaurante e 404 quando não existe", async () => {
  const existente = await request("/restaurants/1");
  assert.equal(existente.status, 200);
  assert.equal(existente.body.name, "Pizzaria Napoli");

  const inexistente = await request("/restaurants/99999");
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.body.error, "Restaurante não encontrado");
});

test("GET /restaurants/:id com id inválido devolve 400, não 500", async () => {
  for (const id of ["abc", "1.5", "-3", "0", "1;DROP TABLE"]) {
    const response = await request(`/restaurants/${encodeURIComponent(id)}`);
    assert.equal(response.status, 400, `id "${id}" deveria dar 400`);
  }
});

test("POST /restaurants exige token", async () => {
  const response = await request("/restaurants", {
    method: "POST",
    body: { name: "Taco Loco", category: "Mexicana", rating: 4 }
  });

  assert.equal(response.status, 401);
});

test("POST /restaurants grava o dono (userId) do restaurante", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");

  const response = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Taco Loco", category: "Mexicana", rating: 4.2 }
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.userId, dono.id);
  assert.equal(response.body.rating, "4.2");
});

test("rating fora da faixa 0–5 é recusado com 400 (inclusive 10, que estoura o Decimal(2,1))", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");

  for (const rating of [7, 10, 5.1, -1, 99.9]) {
    const response = await request("/restaurants", {
      method: "POST",
      token: dono.token,
      body: { name: "Teste", category: "Pizza", rating }
    });

    assert.equal(response.status, 400, `rating ${rating} deveria dar 400`);
    assert.ok(response.body.details.some((d) => d.includes("entre 0 e 5")));
  }
});

test("rating não numérico é recusado e rating ausente vira 0", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");

  const invalido = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Teste", category: "Pizza", rating: "muito bom" }
  });
  assert.equal(invalido.status, 400);

  const ausente = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Sem nota", category: "Pizza" }
  });
  assert.equal(ausente.status, 201);
  assert.equal(ausente.body.rating, "0.0");
});

test("rating com mais de uma casa decimal é arredondado antes de ir ao banco", async () => {
  // Decimal(2,1) guarda uma casa. Arredondar aqui evita que o PostgreSQL
  // faça isso silenciosamente.
  const dono = await criarUsuarioLogado("dono@easyfood.com");

  const response = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Preciso", category: "Pizza", rating: 4.26 }
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.rating, "4.3");
});

test("nome e categoria são obrigatórios e respeitam o tamanho da coluna", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");

  const semNome = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { category: "Pizza" }
  });
  assert.equal(semNome.status, 400);

  const nomeSoEspacos = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "   ", category: "Pizza" }
  });
  assert.equal(nomeSoEspacos.status, 400);

  const nomeLongo = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "a".repeat(151), category: "Pizza" }
  });
  assert.equal(nomeLongo.status, 400);

  const categoriaLonga = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Ok", category: "a".repeat(101) }
  });
  assert.equal(categoriaLonga.status, 400);
});

test("PUT /restaurants/:id: o dono altera, outro usuário recebe 403", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");
  const outro = await criarUsuarioLogado("outro@easyfood.com");

  const criado = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Taco Loco", category: "Mexicana", rating: 4 }
  });

  const semToken = await request(`/restaurants/${criado.body.id}`, {
    method: "PUT",
    body: { name: "Invasor", category: "Pizza" }
  });
  assert.equal(semToken.status, 401);

  const deOutro = await request(`/restaurants/${criado.body.id}`, {
    method: "PUT",
    token: outro.token,
    body: { name: "Invasor", category: "Pizza" }
  });
  assert.equal(deOutro.status, 403);

  const doDono = await request(`/restaurants/${criado.body.id}`, {
    method: "PUT",
    token: dono.token,
    body: { name: "Taco Loco II", category: "Mexicana", rating: 4.8 }
  });
  assert.equal(doDono.status, 200);
  assert.equal(doDono.body.name, "Taco Loco II");
  assert.equal(doDono.body.rating, "4.8");
  assert.equal(doDono.body.userId, dono.id);
});

test("PUT sem rating mantém a nota atual; com rating, atualiza; nota 0 é uma nota", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");

  const criado = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Cantina", category: "Italiana", rating: 4.5 }
  });
  assert.equal(criado.body.rating, "4.5");

  const alterar = (body) =>
    request(`/restaurants/${criado.body.id}`, { method: "PUT", token: dono.token, body });

  const semNota = await alterar({ name: "Cantina Nova", category: "Italiana" });
  assert.equal(semNota.status, 200);
  assert.equal(semNota.body.name, "Cantina Nova");
  assert.equal(semNota.body.rating, "4.5", "a nota não pode ser zerada por omissão");

  const comNota = await alterar({ name: "Cantina Nova", category: "Italiana", rating: 3.2 });
  assert.equal(comNota.body.rating, "3.2");

  const notaZero = await alterar({ name: "Cantina Nova", category: "Italiana", rating: 0 });
  assert.equal(notaZero.status, 200);
  assert.equal(notaZero.body.rating, "0.0");

  const invalida = await alterar({ name: "Cantina Nova", category: "Italiana", rating: 7 });
  assert.equal(invalida.status, 400);
});

test("DELETE /restaurants/:id: sem token 401, de outro dono 403, do dono 204", async () => {
  const dono = await criarUsuarioLogado("dono@easyfood.com");
  const outro = await criarUsuarioLogado("outro@easyfood.com");

  const criado = await request("/restaurants", {
    method: "POST",
    token: dono.token,
    body: { name: "Para excluir", category: "Pizza", rating: 3 }
  });

  const semToken = await request(`/restaurants/${criado.body.id}`, { method: "DELETE" });
  assert.equal(semToken.status, 401);

  const deOutro = await request(`/restaurants/${criado.body.id}`, {
    method: "DELETE",
    token: outro.token
  });
  assert.equal(deOutro.status, 403);

  const doDono = await request(`/restaurants/${criado.body.id}`, {
    method: "DELETE",
    token: dono.token
  });
  assert.equal(doDono.status, 204);
  assert.equal(doDono.text, "");

  const depois = await request(`/restaurants/${criado.body.id}`);
  assert.equal(depois.status, 404);
});

test("restaurante sem dono (seed ou anterior ao vínculo) não pode ser alterado nem excluído", async () => {
  const usuario = await criarUsuarioLogado("alguem@easyfood.com");

  // O restaurante 1 vem do seed do beforeEach, com userId nulo.
  const alterar = await request("/restaurants/1", {
    method: "PUT",
    token: usuario.token,
    body: { name: "Tentando", category: "Pizza" }
  });
  assert.equal(alterar.status, 403);

  const excluir = await request("/restaurants/1", {
    method: "DELETE",
    token: usuario.token
  });
  assert.equal(excluir.status, 403);
});

test("PUT e DELETE em restaurante inexistente devolvem 404", async () => {
  const usuario = await criarUsuarioLogado("alguem@easyfood.com");

  const alterar = await request("/restaurants/98765", {
    method: "PUT",
    token: usuario.token,
    body: { name: "Fantasma", category: "Pizza" }
  });
  assert.equal(alterar.status, 404);

  const excluir = await request("/restaurants/98765", {
    method: "DELETE",
    token: usuario.token
  });
  assert.equal(excluir.status, 404);
});
