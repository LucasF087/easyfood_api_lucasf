// Camada Middleware
// Responsabilidade: limitar tentativas nas rotas de autenticação.
//
// Sem limite, /auth/login aceita quantas tentativas o atacante quiser — o que
// transforma uma senha fraca em questão de tempo. O limite vale por IP e por
// janela de tempo, ambos configuráveis por variável de ambiente.
//
// Observação: o armazenamento é em memória (padrão da biblioteca). Em um
// deploy com mais de uma instância, cada processo teria a sua própria
// contagem — o suficiente para o estágio atual do projeto, registrado em
// "Limitações conhecidas" no README.

const { rateLimit } = require("express-rate-limit");

const config = require("../config/env");

function createAuthRateLimiter(options = {}) {
  const { windowMs, max, enabled } = { ...config.rateLimit, ...options };

  if (!enabled) {
    // Desligado (usado nos testes): middleware que não faz nada.
    return (req, res, next) => next();
  }

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Resposta em JSON, no mesmo formato dos outros erros da API.
    handler: (req, res) => {
      res.status(429).json({
        error: "Muitas tentativas. Aguarde alguns minutos e tente novamente."
      });
    }
  });
}

module.exports = { createAuthRateLimiter };
