-- Vincula cada restaurante ao usuário que o cadastrou.
--
-- A coluna é NULLABLE de propósito: a tabela pode já ter linhas (do seed ou
-- da V1) que não têm dono. Uma coluna NOT NULL quebraria a migration nesses
-- bancos.
--
-- Escrita à mão, no mesmo formato que o `prisma migrate dev` gera, porque o
-- ambiente desta manutenção não tinha um PostgreSQL disponível para rodar o
-- comando. A equivalência com o schema.prisma é verificada por tests/schema.test.js
-- e pode ser confirmada contra um banco real com `npm run prisma:check`
-- (ver README).

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "userId" INTEGER;

-- CreateIndex
CREATE INDEX "Restaurant_userId_idx" ON "Restaurant"("userId");

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
