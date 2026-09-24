// Middleware de autenticação
// Responsabilidade: obter o token JWT (do header Authorization OU do cookie
// httpOnly), validá-lo e, se estiver correto, popular req.user e chamar
// next().
//
// De onde o token pode vir:
//   1. Header "Authorization: Bearer <token>" — usado por Postman, curl,
//      apps mobile e qualquer cliente que não seja o navegador com o
//      front-end de public/.
//   2. Cookie httpOnly (ver src/shared/cookies.js) — usado pelo front-end
//      servido pelo próprio Express desde a migração de sessionStorage para
//      cookie (docs/adr/ADR-006-jwt-em-cookie-httponly.md).
//
// req.authSource guarda qual das duas formas autenticou a requisição.
// csrf.middleware.js usa esse valor: só exige o token CSRF quando a
// autenticação veio do cookie, porque só o cookie é enviado "de graça" pelo
// navegador em requisições que a própria pessoa não iniciou (CSRF). Um
// header Authorization não é ambiente — só existe se o próprio cliente
// (Postman, app, script) decidiu incluí-lo.
//
// Outros dois cuidados, iguais para as duas origens do token:
//   1. O segredo vem de config/env, que se recusa a iniciar se JWT_SECRET
//      estiver ausente ou curto demais. Assim o problema aparece na
//      inicialização, e não como um 500 sem explicação no primeiro login.
//   2. O algoritmo é fixado em HS256 na verificação. Sem isso, um token
//      forjado com outro "alg" passa a ser candidato a validação — é o
//      ataque de confusão de algoritmo.

const jwt = require("jsonwebtoken");

const config = require("../../config/env");
const { AUTH_COOKIE_NAME } = require("../../shared/cookies");

function extractToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return { token, source: "header" };
  }

  // req.cookies só existe se o cookie-parser (registrado em src/app.js) já
  // rodou. Em qualquer teste ou uso que pule esse middleware, cai no ?. e
  // segue como "sem token", em vez de lançar.
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];

  if (cookieToken) {
    return { token: cookieToken, source: "cookie" };
  }

  return null;
}

function authenticate(req, res, next) {
  const found = extractToken(req);

  if (!found) {
    return res.status(401).json({
      error: "Token não fornecido"
    });
  }

  try {
    const payload = jwt.verify(found.token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm]
    });

    req.user = {
      id: Number(payload.sub),
      email: payload.email
    };
    req.authSource = found.source;

    next();
  } catch (error) {
    return res.status(401).json({
      error:
        error.name === "TokenExpiredError"
          ? "Token expirado"
          : "Token inválido ou expirado"
    });
  }
}

module.exports = authenticate;
