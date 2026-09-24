// Camada Routes
// Responsabilidade: definir os caminhos e apontar cada requisição para a
// função correta do Controller.

const express = require("express");

const controller = require("./restaurant.controller");
const authenticate = require("../auth/auth.middleware");
const csrfProtection = require("../auth/csrf.middleware");

const router = express.Router();

// Públicas — qualquer pessoa pode consultar os restaurantes

/**
 * @openapi
 * /restaurants:
 *   get:
 *     tags: [Restaurantes]
 *     summary: Lista todos os restaurantes
 *     responses:
 *       200:
 *         description: Lista de restaurantes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Restaurante' }
 */
router.get("/", controller.list);

/**
 * @openapi
 * /restaurants/{id}:
 *   get:
 *     tags: [Restaurantes]
 *     summary: Busca um restaurante pelo id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Restaurante' } } } }
 *       404: { description: Não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/:id", controller.show);

// Protegidas — exigem um JWT válido (header Authorization OU cookie
// httpOnly). Alterar e excluir exigem, além do token, ser o dono do
// restaurante (a verificação fica no Service).
//
// csrfProtection vem depois de authenticate (precisa de req.authSource) e só
// tem efeito quando a autenticação veio do cookie — ver
// src/modules/auth/csrf.middleware.js.

/**
 * @openapi
 * /restaurants:
 *   post:
 *     tags: [Restaurantes]
 *     summary: Cadastra um restaurante (quem cadastra vira o dono)
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: false
 *         description: Obrigatório apenas quando a autenticação é por cookie.
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/NovoRestaurante' }
 *     responses:
 *       201: { description: Criado, content: { application/json: { schema: { $ref: '#/components/schemas/Restaurante' } } } }
 *       400: { description: Dados inválidos }
 *       401: { description: Não autenticado }
 *       403: { description: Token CSRF ausente ou inválido (autenticação por cookie) }
 */
router.post("/", authenticate, csrfProtection, controller.create);

/**
 * @openapi
 * /restaurants/{id}:
 *   put:
 *     tags: [Restaurantes]
 *     summary: Altera um restaurante (só o dono pode)
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: false
 *         description: Obrigatório apenas quando a autenticação é por cookie.
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/NovoRestaurante' }
 *     responses:
 *       200: { description: Atualizado, content: { application/json: { schema: { $ref: '#/components/schemas/Restaurante' } } } }
 *       403: { description: Não é o dono deste restaurante }
 *       404: { description: Não encontrado }
 */
router.put("/:id", authenticate, csrfProtection, controller.update);

/**
 * @openapi
 * /restaurants/{id}:
 *   delete:
 *     tags: [Restaurantes]
 *     summary: Exclui um restaurante (só o dono pode)
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: false
 *         description: Obrigatório apenas quando a autenticação é por cookie.
 *         schema: { type: string }
 *     responses:
 *       204: { description: Excluído }
 *       403: { description: Não é o dono deste restaurante }
 *       404: { description: Não encontrado }
 */
router.delete("/:id", authenticate, csrfProtection, controller.remove);

module.exports = router;
