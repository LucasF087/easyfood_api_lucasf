// Camada Database
// Responsabilidade: disponibilizar a conexão com o banco (via Prisma)
// para o restante da aplicação. Nenhuma outra camada deve instanciar
// o PrismaClient diretamente — todas importam esta instância única.

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = prisma;
