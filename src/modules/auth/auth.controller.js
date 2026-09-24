// Camada Controller (auth)
// Responsabilidade: receber a requisição HTTP, validar/normalizar a entrada,
// chamar o Auth Service e devolver a resposta correta.
//
// Erros não são tratados com try/catch aqui: o Express 5 encaminha a rejeição
// de um handler async para o error handler central (src/middlewares/
// error-handler.js), que é o único responsável por transformar erro em
// resposta JSON.

const crypto = require("node:crypto");

const authService = require("./auth.service");
const config = require("../../config/env");
const { validateRegister, validateLogin } = require("../../shared/validators");
const { badRequest, unauthorized } = require("../../shared/http-error");
const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  authCookieOptions,
  csrfCookieOptions
} = require("../../shared/cookies");

async function register(req, res) {
  const { data, errors } = validateRegister(req.body ?? {});

  if (errors.length > 0) {
    throw badRequest("Dados inválidos", errors);
  }

  const user = await authService.register(data);

  res.status(201).json(user);
}

async function login(req, res) {
  const { data, errors } = validateLogin(req.body ?? {});

  if (errors.length > 0) {
    throw badRequest("Dados inválidos", errors);
  }

  const result = await authService.login(data);

  if (!result) {
    // Mensagem única para e-mail inexistente e senha errada: não entrega ao
    // atacante a informação de quais e-mails estão cadastrados.
    throw unauthorized("Credenciais inválidas");
  }

  // Além de devolver o token no corpo (para Postman, curl, apps mobile — que
  // não têm cookie de navegador), grava o mesmo token num cookie httpOnly:
  // é esse cookie que o front-end (public/) passa a usar. Junto, um segundo
  // cookie NÃO-httpOnly com um valor aleatório serve de token CSRF — ver
  // csrf.middleware.js e docs/adr/ADR-006-jwt-em-cookie-httponly.md.
  res.cookie(AUTH_COOKIE_NAME, result.token, authCookieOptions(config));
  res.cookie(CSRF_COOKIE_NAME, crypto.randomBytes(24).toString("hex"), csrfCookieOptions(config));

  res.json(result);
}

// Não exige estar autenticado: apagar um cookie que já não existe (ou que já
// expirou) não é um erro, é um no-op. Fica idempotente de propósito.
function logout(req, res) {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions(config));
  res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions(config));

  res.status(204).end();
}

module.exports = {
  register,
  login,
  logout
};
