// Camada Middleware
// Responsabilidade: deixar a requisição em um formato previsível antes de
// chegar aos controllers.

const { unsupportedMediaType } = require("../shared/http-error");

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

// No Express 5, req.body fica undefined quando nenhum parser reconheceu o
// corpo (por exemplo: POST sem body). Sem isso, qualquer desestruturação no
// controller quebra com "Cannot destructure property ... of undefined" e vira
// 500. Os controllers também usam `req.body ?? {}` como segunda proteção.
function normalizeBody(req, res, next) {
  if (req.body === undefined || req.body === null) {
    req.body = {};
  }

  next();
}

// A API só fala JSON. Se o cliente mandar corpo em outro formato, a resposta
// correta é 415 — e não uma validação genérica de campo faltando.
function enforceJsonContentType(req, res, next) {
  if (!METHODS_WITH_BODY.has(req.method)) {
    return next();
  }

  const contentType = req.headers["content-type"];

  // Sem Content-Type e sem corpo: segue para a validação, que responde 400.
  if (!contentType) {
    return next();
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    return next(
      unsupportedMediaType("Content-Type não suportado. Use application/json")
    );
  }

  next();
}

module.exports = { normalizeBody, enforceJsonContentType };
