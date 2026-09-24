// Camada Service (notifications)
// Responsabilidade: as três reações previstas no cenário da ADR-005 quando um
// restaurante é cadastrado — e-mail de boas-vindas, registro de atividade e
// aviso ao time comercial.
//
// IMPORTANTE: nada aqui envia e-mail de verdade. Cada ação é uma SIMULAÇÃO
// que escreve uma linha no log do servidor. O objetivo é demonstrar o custo
// do acoplamento descrito na ADR-005 (comunicação direta, síncrona, sem
// eventos) sem depender de SMTP, credenciais ou de um e-mail pessoal
// hardcoded no repositório.
//
// O destinatário do aviso comercial vem de COMMERCIAL_EMAIL; o padrão usa o
// domínio reservado ".example", que não existe na internet.
//
// Se/quando a decisão da ADR-005 for revista (eventos, fila, broker), este é
// o módulo que passa a ser um consumidor de `restaurant.created` em vez de
// ser chamado diretamente pelo Restaurant Service.

const logger = require("../../shared/logger");

const DEFAULT_COMMERCIAL_EMAIL = "comercial@easyfood.example";

// Lido a cada chamada (e não no carregamento do módulo) para que testes e
// ambientes possam ligar/desligar sem reiniciar o processo.
function isEnabled() {
  const raw = String(process.env.NOTIFICATIONS_ENABLED ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function commercialEmail() {
  const configured = String(process.env.COMMERCIAL_EMAIL ?? "").trim();
  return configured || DEFAULT_COMMERCIAL_EMAIL;
}

function simulate(action, payload) {
  if (!isEnabled()) {
    return { action, skipped: true };
  }

  logger.info(`[simulação] ${action}`, payload);

  return { action, skipped: false, payload };
}

// 1) E-mail de boas-vindas para quem cadastrou o restaurante.
function sendWelcomeEmail({ to, name, restaurantName }) {
  return simulate("email.boas-vindas", {
    to,
    assunto: `Bem-vindo(a) à EasyFood, ${name ?? "parceiro(a)"}!`,
    corpo: `O restaurante "${restaurantName}" foi cadastrado com sucesso.`
  });
}

// 2) Registro de atividade (trilha simples do que aconteceu no sistema).
function registerActivity({ action, restaurantId, restaurantName, userId }) {
  return simulate("atividade.registrada", {
    acao: action,
    restauranteId: restaurantId,
    restaurante: restaurantName,
    usuarioId: userId ?? null
  });
}

// 3) Aviso ao time comercial.
function notifyCommercialTeam({ restaurantId, restaurantName, category, ownerEmail }) {
  return simulate("comercial.novo-restaurante", {
    to: commercialEmail(),
    restauranteId: restaurantId,
    restaurante: restaurantName,
    categoria: category ?? null,
    responsavel: ownerEmail ?? null
  });
}

// Orquestra as três reações do cenário da ADR-005.
//
// Uma falha em qualquer uma delas NÃO pode derrubar o cadastro do
// restaurante, que já foi gravado no banco. Essa é justamente a consequência
// negativa registrada na ADR-005: com chamada direta e síncrona, quem chama
// precisa se proteger sozinho de quem é chamado.
function notifyRestaurantCreated({ restaurant, owner }) {
  const results = [];

  try {
    results.push(
      registerActivity({
        action: "restaurant.created",
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        userId: owner?.id
      })
    );

    if (owner?.email) {
      results.push(
        sendWelcomeEmail({
          to: owner.email,
          name: owner.name,
          restaurantName: restaurant.name
        })
      );
    }

    results.push(
      notifyCommercialTeam({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        category: restaurant.category,
        ownerEmail: owner?.email
      })
    );
  } catch (error) {
    logger.error("Falha ao notificar o cadastro do restaurante", {
      restauranteId: restaurant?.id,
      motivo: error?.message
    });
  }

  return results;
}

module.exports = {
  DEFAULT_COMMERCIAL_EMAIL,
  isEnabled,
  commercialEmail,
  sendWelcomeEmail,
  registerActivity,
  notifyCommercialTeam,
  notifyRestaurantCreated
};
