// Camada Middleware
// Responsabilidade: garantir que TODA resposta de erro saia em JSON, com uma
// mensagem controlada, e que o detalhe técnico fique só no log do servidor.
//
// O que o Express faz por padrão, e por que isso não serve aqui:
//   - erro não tratado (por exemplo, POST sem body) -> 500 em HTML com stack
//     trace, que expõe caminhos do servidor
//   - JSON malformado -> a mesma página de erro, também em HTML
//   - rota inexistente -> 404 em HTML
//
// Casos cobertos aqui, todos em JSON:
//   400  entrada inválida (validação) e JSON malformado
//   401  token ausente/inválido (gerado no middleware de autenticação)
//   403  usuário autenticado sem permissão sobre o recurso
//   404  rota inexistente e recurso inexistente
//   409  conflito (e-mail já cadastrado)
//   413  corpo acima do limite
//   415  Content-Type não suportado
//   429  rate limit
//   500  qualquer erro inesperado — mensagem genérica, stack só no log

const logger = require("../shared/logger");
const { HttpError } = require("../shared/http-error");

// Corta o caminho para não ecoar uma URL gigante de volta ao cliente.
function safePath(req) {
  const original = String(req.originalUrl || req.url || "");
  return original.length > 200 ? `${original.slice(0, 200)}…` : original;
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Rota não encontrada",
    method: req.method,
    path: safePath(req)
  });
}

// Traduz erros conhecidos do Express, do body-parser e do Prisma para uma
// resposta previsível. Tudo que não estiver mapeado aqui é tratado como
// erro inesperado (500).
function translate(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        ...(error.details ? { details: error.details } : {})
      },
      unexpected: false
    };
  }

  // express.json() falhou ao interpretar o corpo da requisição.
  if (error.type === "entity.parse.failed") {
    return {
      status: 400,
      body: { error: "JSON inválido no corpo da requisição" },
      unexpected: false
    };
  }

  // Corpo maior que o limite configurado (express.json({ limit })).
  if (error.type === "entity.too.large") {
    return {
      status: 413,
      body: { error: "Corpo da requisição acima do limite permitido" },
      unexpected: false
    };
  }

  if (error.type === "encoding.unsupported" || error.type === "charset.unsupported") {
    return {
      status: 415,
      body: { error: "Codificação do corpo da requisição não suportada" },
      unexpected: false
    };
  }

  // Erros conhecidos do Prisma que podem escapar do Service.
  if (error.code === "P2002") {
    return {
      status: 409,
      body: { error: "Registro já existente" },
      unexpected: false
    };
  }

  if (error.code === "P2025") {
    return {
      status: 404,
      body: { error: "Registro não encontrado" },
      unexpected: false
    };
  }

  // Banco fora do ar / string de conexão errada. É esperado em ambiente mal
  // configurado, mas o cliente não precisa saber o motivo exato.
  if (typeof error.code === "string" && error.code.startsWith("P1")) {
    return {
      status: 503,
      body: { error: "Serviço indisponível no momento" },
      unexpected: true
    };
  }

  return {
    status: 500,
    body: { error: "Erro interno do servidor" },
    unexpected: true
  };
}

// eslint-disable-next-line no-unused-vars -- o Express só reconhece o error
// handler se a função tiver exatamente 4 parâmetros.
function errorHandler(error, req, res, next) {
  const { status, body, unexpected } = translate(error);

  const context = {
    method: req.method,
    path: safePath(req),
    status
  };

  if (unexpected) {
    // Único lugar do projeto onde o stack trace é escrito — no log,
    // nunca na resposta.
    logger.error(`Erro não tratado: ${error?.message ?? error}`, {
      ...context,
      name: error?.name,
      code: error?.code,
      stack: error?.stack
    });
  } else {
    logger.warn(`Requisição rejeitada: ${body.error}`, context);
  }

  // Se a resposta já começou a ser enviada, não dá para trocar o status:
  // encerra a conexão e deixa o Express registrar o problema.
  if (res.headersSent) {
    return next(error);
  }

  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
