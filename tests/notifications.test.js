// Cenário da ADR-005 simulado com log.
//
// O que se verifica aqui: as três reações previstas acontecem quando um
// restaurante é cadastrado, nenhum e-mail real é enviado e o endereço do
// comercial não é um e-mail pessoal fixo no código.

const test = require("node:test");
const assert = require("node:assert/strict");

const notifications = require("../src/modules/notifications/notification.service");

function capturarLog(fn) {
  const linhas = [];
  const original = console.log;

  console.log = (...args) => linhas.push(args.join(" "));

  try {
    fn();
  } finally {
    console.log = original;
  }

  return linhas.join("\n");
}

test.beforeEach(() => {
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.LOG_LEVEL = "";
  delete process.env.COMMERCIAL_EMAIL;
});

test.after(() => {
  process.env.NOTIFICATIONS_ENABLED = "false";
  process.env.LOG_LEVEL = "silent";
});

test("o cadastro dispara as três reações previstas na ADR-005", () => {
  const log = capturarLog(() => {
    notifications.notifyRestaurantCreated({
      restaurant: { id: 7, name: "Taco Loco", category: "Mexicana" },
      owner: { id: 1, name: "Dona Ana", email: "ana@easyfood.com" }
    });
  });

  assert.match(log, /atividade\.registrada/);
  assert.match(log, /email\.boas-vindas/);
  assert.match(log, /comercial\.novo-restaurante/);
  assert.match(log, /Taco Loco/);
  assert.match(log, /simulação/);
});

test("o e-mail do comercial não é um endereço pessoal fixo no código", () => {
  // O padrão usa o domínio reservado .example, que não existe na internet.
  assert.equal(notifications.commercialEmail(), "comercial@easyfood.example");
  assert.match(notifications.DEFAULT_COMMERCIAL_EMAIL, /@easyfood\.example$/);

  process.env.COMMERCIAL_EMAIL = "vendas@empresa.com.br";
  assert.equal(notifications.commercialEmail(), "vendas@empresa.com.br");
});

test("com NOTIFICATIONS_ENABLED=false nada é enviado nem registrado", () => {
  process.env.NOTIFICATIONS_ENABLED = "false";

  const log = capturarLog(() => {
    const resultados = notifications.notifyRestaurantCreated({
      restaurant: { id: 1, name: "Silencioso", category: "Pizza" },
      owner: { id: 1, email: "ana@easyfood.com" }
    });

    assert.ok(resultados.every((resultado) => resultado.skipped === true));
  });

  assert.equal(log, "");
});

test("uma falha na notificação não derruba o cadastro do restaurante", () => {
  const original = console.log;
  console.log = () => {
    throw new Error("log indisponível");
  };

  try {
    // A função precisa engolir o erro: o restaurante já foi gravado no banco.
    assert.doesNotThrow(() => {
      notifications.notifyRestaurantCreated({
        restaurant: { id: 2, name: "Resiliente", category: "Pizza" },
        owner: { id: 1, email: "ana@easyfood.com" }
      });
    });
  } finally {
    console.log = original;
  }
});
