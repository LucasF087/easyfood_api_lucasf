// Camada App
// Responsabilidade: configurar a aplicação — segurança, middlewares, JSON,
// arquivos estáticos (interface HTML), registro das rotas de cada módulo e
// tratamento de erros.
//
// A ORDEM importa: segurança -> parsers -> estáticos -> rotas -> 404 -> erro.
// O handler de 404 e o error handler ficam obrigatoriamente por último, senão
// o Express usa os dele, que respondem em HTML (com stack trace em
// desenvolvimento).

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const path = require("path");

// Carrega e valida as variáveis de ambiente antes de qualquer outra coisa.
// Se JWT_SECRET estiver ausente ou curto, o require abaixo lança
// EnvironmentError e a aplicação nem chega a subir.
const config = require("./config/env");
const swaggerSpec = require("./config/swagger");

const restaurantRoutes = require("./modules/restaurants/restaurant.routes");
const authRoutes = require("./modules/auth/auth.routes");
const healthRoutes = require("./modules/health/health.routes");
const { normalizeBody, enforceJsonContentType } = require("./middlewares/request");
const { notFoundHandler, errorHandler } = require("./middlewares/error-handler");

const app = express();

// Atrás de um proxy reverso (deploy), o Express precisa saber em quantos
// proxies confiar para enxergar o IP real do cliente. Sem isso, o rate limit de
// /auth conta todos os usuários como se fossem um só. Ver TRUST_PROXY em
// src/config/env.js.
app.set("trust proxy", config.trustProxy);

// Remove o header "X-Powered-By: Express", que entrega o framework (e a pista
// de quais exploits tentar) para qualquer um que faça uma requisição.
// O helmet também faz isso; manter as duas linhas deixa a intenção explícita
// e mantém a proteção caso o helmet seja reconfigurado.
app.disable("x-powered-by");

// Documentação da API (Swagger UI), ANTES do helmet(config) abaixo — de
// propósito. O swagger-ui-express serve um HTML com script/style inline, que
// a Content-Security-Policy estrita da API bloquearia. Montar a rota aqui
// faz /docs responder e encerrar a cadeia antes de chegar no helmet, sem
// afrouxar a CSP para o resto da aplicação (/health, /auth, /restaurants).
// Pode ser desligado em produção com API_DOCS_ENABLED=false.
if (config.apiDocs.enabled) {
  app.get("/docs.json", (req, res) => res.json(swaggerSpec));
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: "EasyFood API — documentação"
    })
  );
}

// Cabeçalhos de segurança. A CSP é escrita à mão, em vez de usar o padrão do
// helmet, por dois motivos:
//   - o padrão inclui "upgrade-insecure-requests", que atrapalha o uso local
//     em http://localhost;
//   - declarar as diretivas aqui documenta que a página só carrega CSS e JS
//     da própria origem (por isso o CSS e o JS ficam em arquivos próprios, sem
//     código nem atributo style inline).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "script-src": ["'self'"],
        // Bloqueia handlers inline (onclick="..."). A interface usa
        // addEventListener em public/js/app.js.
        "script-src-attr": ["'none'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"]
      }
    },
    // A API é servida por http em desenvolvimento; HSTS só faz sentido atrás
    // de HTTPS e é ignorado pelo navegador em http.
    crossOriginEmbedderPolicy: false
  })
);

// CORS: fora de produção o padrão libera qualquer origem; em produção, sem
// CORS_ORIGIN, nenhum cabeçalho é enviado (só a mesma origem funciona). Ver
// CORS_ORIGIN em src/config/env.js.
//
// credentials: true permite que um front-end em OUTRA origem use o cookie de
// autenticação (fetch com credentials: "include"). Não afeta o front-end
// deste projeto, servido pela própria API (mesma origem: CORS nem entra em
// jogo). Atenção se for configurar CORS_ORIGIN=* junto de um front-end
// externo: navegadores recusam a combinação "Access-Control-Allow-Origin: *"
// com credenciais — nesse caso defina CORS_ORIGIN com a origem exata
// (https://meu-front.exemplo.com), nunca "*".
if (config.cors.origin) {
  app.use(cors({ origin: config.cors.origin, credentials: true }));
}

// Lê o cookie do JWT e o cookie CSRF (src/shared/cookies.js) em req.cookies.
// Sem segredo/assinatura: o valor gravado é o próprio JWT, que já é
// assinado, e o valor do cookie CSRF é comparado byte a byte com o header —
// nenhum dos dois precisa da assinatura extra que cookie-parser ofereceria.
app.use(cookieParser());

// Limite de corpo: a API só recebe JSON pequeno. Sem limite, o Express aceita
// payloads grandes o bastante para consumir memória do processo.
app.use(enforceJsonContentType);
app.use(express.json({ limit: config.bodyLimit }));
app.use(normalizeBody);

app.use(express.static(path.join(__dirname, "../public")));

app.use("/health", healthRoutes);
app.use("/auth", authRoutes);
app.use("/restaurants", restaurantRoutes);

// Qualquer rota não registrada acima cai aqui — em JSON, não em HTML.
app.use(notFoundHandler);

// Último middleware da cadeia: transforma qualquer erro em resposta JSON
// controlada e mantém o stack trace apenas no log do servidor.
app.use(errorHandler);

module.exports = app;
