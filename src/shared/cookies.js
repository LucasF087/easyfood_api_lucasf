// Camada Shared
// Responsabilidade: centralizar nomes de cookies e as opções usadas para
// escrevê-los, para que auth.controller.js, auth.middleware.js e
// csrf.middleware.js nunca fiquem fora de sincronia sobre nome/atributos.
//
// Ver docs/adr/ADR-006-jwt-em-cookie-httponly.md para o raciocínio completo.

const AUTH_COOKIE_NAME = "easyfood_token";
const CSRF_COOKIE_NAME = "easyfood_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

// Opções do cookie que carrega o JWT.
//   - httpOnly: JavaScript no navegador não consegue ler nem roubar este
//     cookie via XSS (é o ganho principal em relação ao sessionStorage).
//   - sameSite "lax": o navegador não envia o cookie em requisições
//     cross-site que não sejam navegação de topo (bloqueia a maior parte do
//     CSRF "de tabuleiro" antes mesmo de chegar ao servidor).
//   - secure: só é enviado por HTTPS. Ligado automaticamente em produção
//     (ver COOKIE_SECURE em src/config/env.js); desligado em desenvolvimento
//     porque http://localhost não tem HTTPS.
//   - sem maxAge/expires: cookie de sessão do navegador — é apagado quando a
//     aba/janela fecha, preservando a mesma intenção que o comentário
//     original do projeto tinha para o sessionStorage ("não sobrevive ao
//     fechamento da aba").
function authCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookies.secure,
    path: "/"
  };
}

// Cookie do token CSRF: precisa ser LEGÍVEL pelo JavaScript do front-end (para
// ele copiar o valor num header a cada requisição que muda estado), então
// NUNCA leva httpOnly. Os outros atributos seguem o mesmo raciocínio do
// cookie de autenticação.
function csrfCookieOptions(config) {
  return {
    httpOnly: false,
    sameSite: "lax",
    secure: config.cookies.secure,
    path: "/"
  };
}

module.exports = {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  authCookieOptions,
  csrfCookieOptions
};
