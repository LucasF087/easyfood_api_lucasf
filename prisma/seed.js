// Seed: dados iniciais para desenvolvimento.
//
// Idempotente: pode ser rodado mais de uma vez sem duplicar registros. O seed
// consulta o que já existe e insere apenas o que falta. (Usar
// `createMany({ skipDuplicates: true })` não bastaria: ele só pula conflitos de
// chave única, e o campo `name` de Restaurant não é único.)
//
// O usuário de demonstração é OPCIONAL: só é criado com SEED_DEMO_USER=true
// (no .env) e nunca com NODE_ENV=production. A senha dele é pública (está no
// código e no README), então ele não deve existir em um banco publicado.

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const RESTAURANTES = [
  { name: "Pizzaria Napoli", category: "Pizza", rating: 4.5 },
  { name: "Burger House", category: "Burger", rating: 4.2 },
  { name: "Sushi Express", category: "Japonesa", rating: 4.8 }
];

// Usuário de demonstração (opcional, ver o topo do arquivo).
// Serve para testar login e cadastro sem precisar criar conta na mão.
const USUARIO_DEMO = {
  name: "Aluno EasyFood",
  email: "demo@easyfood.local",
  password: "easyfood123"
};

async function semearRestaurantes() {
  const existentes = await prisma.restaurant.findMany({
    select: { name: true }
  });

  const nomes = new Set(existentes.map((restaurante) => restaurante.name));
  const faltando = RESTAURANTES.filter((restaurante) => !nomes.has(restaurante.name));

  if (faltando.length === 0) {
    console.log("Restaurantes de exemplo já estavam no banco.");
    return;
  }

  // Os restaurantes do seed ficam sem dono (userId nulo) de propósito: eles
  // não pertencem a ninguém e, por isso, não podem ser editados nem
  // excluídos pela API.
  await prisma.restaurant.createMany({ data: faltando });

  console.log(`${faltando.length} restaurante(s) inserido(s).`);
}

function demoHabilitado() {
  return String(process.env.SEED_DEMO_USER ?? "").trim().toLowerCase() === "true";
}

async function semearUsuarioDemo() {
  if (process.env.NODE_ENV === "production") {
    console.log("NODE_ENV=production: usuário de demonstração não foi criado.");
    return;
  }

  if (!demoHabilitado()) {
    console.log(
      "Usuário de demonstração não criado (para criá-lo, defina SEED_DEMO_USER=true no .env)."
    );
    return;
  }

  const existente = await prisma.user.findUnique({
    where: { email: USUARIO_DEMO.email }
  });

  if (existente) {
    console.log("Usuário de demonstração já existia.");
    return;
  }

  await prisma.user.create({
    data: {
      name: USUARIO_DEMO.name,
      email: USUARIO_DEMO.email,
      password: await bcrypt.hash(USUARIO_DEMO.password, 10)
    }
  });

  console.log(
    `Usuário de demonstração criado: ${USUARIO_DEMO.email} / ${USUARIO_DEMO.password}\n` +
      "  ATENÇÃO: credencial de desenvolvimento. Nunca rode este seed em produção."
  );
}

async function main() {
  await semearRestaurantes();
  await semearUsuarioDemo();
  console.log("Seed concluído.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
