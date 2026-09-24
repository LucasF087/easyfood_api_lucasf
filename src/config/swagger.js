// Camada Config
// Responsabilidade: montar a especificação OpenAPI a partir dos comentários
// `@openapi` escritos em cima de cada rota (swagger-jsdoc só lê comentário,
// não código — então documentação errada não quebra a API, mas também não é
// verificada automaticamente: revisar ao mexer numa rota é manual).
//
// Por que documentar assim, em vez de um arquivo openapi.yaml solto:
//   a documentação fica ao lado da rota que descreve, no mesmo arquivo — RH
//   muda a rota, o comentário está ali do lado para lembrar de atualizar. Um
//   YAML separado tende a desatualizar sem ninguém perceber.

const swaggerJsdoc = require("swagger-jsdoc");
const path = require("path");

const definition = {
  openapi: "3.0.3",
  info: {
    title: "EasyFood API",
    version: "1.2.0",
    description:
      "API de cadastro e listagem de restaurantes, com autenticação JWT " +
      "(header Authorization ou cookie httpOnly) e persistência em " +
      "PostgreSQL via Prisma. Projeto acadêmico — Unifecaf.",
    license: { name: "MIT" }
  },
  servers: [{ url: "/", description: "Servidor atual" }],
  tags: [
    { name: "Auth", description: "Cadastro, login, sessão e logout" },
    { name: "Restaurantes", description: "Consulta e gestão de restaurantes" },
    { name: "Health", description: "Verificação de disponibilidade do serviço" }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Token recebido em POST /auth/login, no campo \"token\"."
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "easyfood_token",
        description:
          "Cookie httpOnly gravado automaticamente pelo navegador no login. " +
          "Usado pelo front-end de public/; exige também o header " +
          "X-CSRF-Token em POST/PUT/DELETE (ver csrf.middleware.js)."
      }
    },
    schemas: {
      Usuario: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Aluno EasyFood" },
          email: { type: "string", format: "email", example: "aluno@easyfood.com" }
        }
      },
      Restaurante: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Taco Loco" },
          category: { type: "string", example: "Mexicana" },
          rating: { type: "string", example: "4.3", description: "Decimal serializado como string pelo Prisma" },
          userId: { type: "integer", nullable: true, example: 7 }
        }
      },
      NovoRestaurante: {
        type: "object",
        required: ["name", "category"],
        properties: {
          name: { type: "string", example: "Taco Loco" },
          category: { type: "string", example: "Mexicana" },
          rating: { type: "number", format: "float", minimum: 0, maximum: 5, example: 4.3 }
        }
      },
      Credenciais: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" }
        }
      },
      Erro: {
        type: "object",
        properties: {
          error: { type: "string", example: "Dados inválidos" },
          details: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

const options = {
  definition,
  // Só arquivos de rota têm anotação @openapi — services e controllers não
  // precisam ser varridos.
  apis: [path.join(__dirname, "../modules/**/*.routes.js")]
};

module.exports = swaggerJsdoc(options);
