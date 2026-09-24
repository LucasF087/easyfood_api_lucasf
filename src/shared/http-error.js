// Camada Shared
// Responsabilidade: representar erros que o cliente pode ver.
//
// Regra do projeto: só erros criados aqui viram mensagem para o cliente.
// Qualquer outro erro é tratado como inesperado pelo error handler, que
// responde 500 com uma mensagem genérica e registra o detalhe no log.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.expected = true;

    if (details !== undefined) {
      this.details = Array.isArray(details) ? details : [details];
    }
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = (message) => new HttpError(401, message);
const forbidden = (message) => new HttpError(403, message);
const notFound = (message) => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);
const unsupportedMediaType = (message) => new HttpError(415, message);
const payloadTooLarge = (message) => new HttpError(413, message);

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unsupportedMediaType,
  payloadTooLarge
};
