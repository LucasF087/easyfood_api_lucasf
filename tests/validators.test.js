// Testes de unidade das regras de validação.
//
// Os testes de HTTP (auth.test.js, restaurants.test.js) já exercitam essas
// regras pela API. Aqui elas são verificadas isoladamente, com os casos de
// borda que seriam trabalhosos de montar por requisição.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateLoginPassword,
  validateLogin,
  validateRating,
  validateId,
  validateRestaurant,
  LIMITS
} = require("../src/shared/validators");

function validar(fn, valor) {
  const errors = [];
  const resultado = fn(valor, errors);
  return { resultado, errors };
}

test("normalizeEmail apara espaços e baixa a caixa", () => {
  assert.equal(normalizeEmail("  Ana@X.COM  "), "ana@x.com");
  assert.equal(normalizeEmail("ja@minusculo.com"), "ja@minusculo.com");
  // Valor não textual passa intacto: quem recusa é o validador.
  assert.equal(normalizeEmail(42), 42);
});

test("validateEmail aceita endereços comuns", () => {
  const validos = [
    "ana@x.com",
    "ana.maria@empresa.com.br",
    "ana+promo@x.io",
    "ana_maria-99@sub.dominio.org"
  ];

  for (const email of validos) {
    const { errors } = validar(validateEmail, email);
    assert.deepEqual(errors, [], `"${email}" deveria ser aceito`);
  }
});

test("validateEmail recusa endereços malformados", () => {
  const invalidos = ["", "ana", "ana@", "@x.com", "ana@x", "a b@x.com", "ana@@x.com"];

  for (const email of invalidos) {
    const { errors } = validar(validateEmail, email);
    assert.equal(errors.length, 1, `"${email}" deveria ser recusado`);
  }
});

test("validateEmail respeita o tamanho da coluna VarChar(150)", () => {
  const longo = `${"a".repeat(140)}@exemplo.com`; // 152 caracteres

  const { errors } = validar(validateEmail, longo);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /150 caracteres/);
});

test("validatePassword usa bytes, não caracteres, no limite do bcrypt", () => {
  assert.equal(LIMITS.PASSWORD_MAX_BYTES, 72);

  // 72 bytes ASCII: aceito.
  assert.deepEqual(validar(validatePassword, "a".repeat(72)).errors, []);

  // 73 bytes ASCII: recusado.
  assert.equal(validar(validatePassword, "a".repeat(73)).errors.length, 1);

  // 24 caracteres "é" = 48 bytes: aceito.
  assert.deepEqual(validar(validatePassword, "é".repeat(24)).errors, []);

  // 37 caracteres "é" = 74 bytes: recusado, mesmo tendo menos de 72 letras.
  assert.equal(validar(validatePassword, "é".repeat(37)).errors.length, 1);
});

test("validatePassword não apara espaços da senha", () => {
  const { resultado, errors } = validar(validatePassword, "  senha  ");

  assert.deepEqual(errors, []);
  assert.equal(resultado.value, "  senha  ");
});

test("validateLoginPassword só exige texto não vazio (o tamanho vale no cadastro)", () => {
  assert.equal(validar(validateLoginPassword, "1").resultado.value, "1");
  assert.equal(validar(validateLoginPassword, "a".repeat(200)).resultado.value, "a".repeat(200));

  for (const invalido of [undefined, null, "", 123456, ["123456"], {}]) {
    const { errors } = validar(validateLoginPassword, invalido);
    assert.equal(errors.length, 1, `senha ${JSON.stringify(invalido)} deveria ser recusada`);
  }
});

test("validateLogin aceita senha curta e normaliza o e-mail", () => {
  const { data, errors } = validateLogin({ email: "  Ana@X.com ", password: "12345" });

  assert.deepEqual(errors, []);
  assert.deepEqual(data, { email: "ana@x.com", password: "12345" });
});

test("validateRating cobre faixa, formato e arredondamento", () => {
  assert.equal(validar(validateRating, undefined).resultado.value, 0);
  assert.equal(validar(validateRating, "").resultado.value, 0);
  assert.equal(validar(validateRating, 4.5).resultado.value, 4.5);
  assert.equal(validar(validateRating, "4,7").resultado.value, 4.7); // vírgula
  assert.equal(validar(validateRating, 4.26).resultado.value, 4.3); // Decimal(2,1)
  assert.equal(validar(validateRating, 0).resultado.value, 0);
  assert.equal(validar(validateRating, 5).resultado.value, 5);

  for (const invalido of [7, 10, -0.1, 5.01, "abc", true, {}, [], NaN, Infinity]) {
    const { errors } = validar(validateRating, invalido);
    assert.equal(errors.length, 1, `rating ${JSON.stringify(invalido)} deveria ser recusado`);
  }
});

test("validateRating com keepWhenMissing omite o campo quando a nota não vem", () => {
  const manter = (valor) => {
    const errors = [];
    const resultado = validateRating(valor, errors, { keepWhenMissing: true });
    return { resultado, errors };
  };

  for (const ausente of [undefined, null, ""]) {
    const { resultado, errors } = manter(ausente);
    assert.equal(resultado, undefined);
    assert.deepEqual(errors, []);
  }

  assert.equal(manter(0).resultado.value, 0, "0 é uma nota, não ausência");
  assert.equal(manter(4.5).resultado.value, 4.5);
  assert.equal(manter(7).errors.length, 1);
});

test("validateId aceita apenas inteiros positivos", () => {
  assert.equal(validar(validateId, "7").resultado.value, 7);
  assert.equal(validar(validateId, 7).resultado.value, 7);

  for (const invalido of ["0", "-1", "1.5", "abc", "", "1e3", "7; DROP TABLE"]) {
    const { errors } = validar(validateId, invalido);
    assert.equal(errors.length, 1, `id "${invalido}" deveria ser recusado`);
  }
});

test("validateRestaurant devolve todos os erros de uma vez", () => {
  const { errors } = validateRestaurant({ name: "", category: "", rating: 99 });

  assert.equal(errors.length, 3);
});

test("validateRestaurant: nota omitida vira 0 no cadastro e some do resultado na alteração", () => {
  const corpo = { name: "Taco Loco", category: "Mexicana" };

  const cadastro = validateRestaurant(corpo);
  assert.deepEqual(cadastro.errors, []);
  assert.equal(cadastro.data.rating, 0);

  const alteracao = validateRestaurant(corpo, { isUpdate: true });
  assert.deepEqual(alteracao.errors, []);
  assert.equal("rating" in alteracao.data, false);
});

test("validateRestaurant apara espaços de nome e categoria", () => {
  const { data, errors } = validateRestaurant({
    name: "  Taco Loco  ",
    category: "  Mexicana  ",
    rating: 4
  });

  assert.deepEqual(errors, []);
  assert.equal(data.name, "Taco Loco");
  assert.equal(data.category, "Mexicana");
});
