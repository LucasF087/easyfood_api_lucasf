// Middleware CSRF (padrão "double submit cookie")
// Responsabilidade: recusar requisições que mudam estado e foram autenticadas
// via cookie, quando o header X-CSRF-Token não bate com o cookie
// easyfood_csrf.
//
// Por que isso só é necessário por causa do cookie:
//   Um cookie é enviado pelo navegador automaticamente em toda requisição
//   para o domínio dele — inclusive uma que a própria pessoa não iniciou (um
//   <form> ou fetch de outro site). Isso é exatamente o ataque CSRF: um site
//   malicioso faz o navegador da vítima mandar, por exemplo, um
//   POST /restaurants "de graça", usando o cookie de sessão que já está
//   guardado no navegador dela.
//
//   Um header Authorization: Bearer não tem esse problema, porque nenhum
//   navegador anexa headers arbitrários sozinho — só o próprio código do
//   cliente (o app.js deste projeto, um script, o Postman) decide mandar um.
//   Por isso este middleware é pulado quando req.authSource === "header"
//   (ver auth.middleware.js): só a via cookie precisa da defesa extra.
//
// Como o "double submit cookie" funciona sem guardar nada no servidor:
//   1. No login, o servidor manda dois cookies: o do JWT (httpOnly, o site
//      malicioso não consegue ler) e um token CSRF aleatório (SEM httpOnly,
//      de propósito — o front-end do próprio EasyFood precisa conseguir lê-lo
//      com JavaScript).
//   2. A cada requisição que muda estado, o front-end lê o cookie CSRF e o
//      repete manualmente num header (X-CSRF-Token).
//   3. Um site malicioso consegue fazer o navegador da vítima enviar o
//      cookie automaticamente, mas não consegue LER o valor do cookie CSRF
//      (a política de mesma origem do navegador bloqueia isso) — logo não
//      tem como colocar o valor certo no header. Cookie e header só batem
//      quando quem está chamando é, de fato, o front-end do EasyFood.
//
// É essa leitura manual do cookie + o header extra em toda chamada que
// exigiram mais código do que o esquema anterior (token em sessionStorage,
// mandado à mão em Authorization): sessionStorage não é ambiente — só ia
// junto quando o próprio app.js decidia mandar, então nunca precisou de
// proteção contra CSRF.

const { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } = require("../../shared/cookies");

function csrfProtection(req, res, next) {
  // Autenticado por Authorization: Bearer — não é ambiente, CSRF não se
  // aplica. Ver o porquê no comentário acima.
  if (req.authSource !== "cookie") {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      error: "Token CSRF ausente ou inválido"
    });
  }

  next();
}

module.exports = csrfProtection;
