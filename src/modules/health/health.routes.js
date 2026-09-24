// Camada Routes (health)
// Responsabilidade: responder se o processo está de pé.
//
// É um check de *liveness*: responde 200 sem tocar no banco. Serviços de
// deploy (Render, Railway, Fly, Kubernetes) usam esse tipo de rota para saber
// se devem reiniciar ou manter a instância — se ela dependesse do banco, uma
// instabilidade momentânea do PostgreSQL derrubaria a aplicação inteira.
//
// Um check de *readiness* (que consulta o banco) é um passo natural da 2ª
// entrega e está registrado em "Próximos passos" no README.

const express = require("express");

const router = express.Router();

const startedAt = Date.now();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Verifica se o processo está de pé (liveness)
 *     description: >
 *       Não consulta o banco de dados de propósito — ver o comentário no
 *       topo deste arquivo. Um check de *readiness* (que consulta o banco)
 *       está registrado em "Próximos passos" no README.
 *     responses:
 *       200:
 *         description: Serviço no ar
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 uptime: { type: integer, example: 42, description: "segundos" }
 *                 timestamp: { type: string, format: date-time }
 */
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    uptime: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
