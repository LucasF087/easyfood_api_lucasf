// Camada Service (auth)
// Responsabilidade: regras de negócio de autenticação — hash de senha,
// verificação de credenciais e emissão do token JWT.
//
// O service recebe dados já normalizados e validados pelo controller
// (e-mail em minúsculas e sem espaços, senha dentro do limite do bcrypt).

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const prisma = require("../../database/prisma");
const config = require("../../config/env");
const { conflict } = require("../../shared/http-error");

const SALT_ROUNDS = 10;

// Hash válido de uma senha que ninguém conhece. Serve para gastar o mesmo
// tempo de CPU quando o e-mail não existe (ver comentário no login).
const DUMMY_HASH = "$2a$10$x2o/OHl4aunqtGul/zIZEuXtgV42ZMYCgOXvVweUne8ViPn5047sa";

async function register({ name, email, password }) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: { name, email, password: hash }
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email
    };
  } catch (error) {
    // P2002 = violação de índice único (o e-mail já existe).
    if (error.code === "P2002") {
      throw conflict("E-mail já cadastrado");
    }

    throw error;
  }
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    // Compara mesmo sem usuário para que a resposta leve aproximadamente o
    // mesmo tempo com e sem conta existente (evita descobrir e-mails válidos
    // pelo tempo de resposta).
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const senhaConfere = await bcrypt.compare(password, user.password);

  if (!senhaConfere) {
    return null;
  }

  const token = jwt.sign(
    {
      sub: String(user.id),
      email: user.email
    },
    config.jwt.secret,
    {
      algorithm: config.jwt.algorithm,
      expiresIn: config.jwt.expiresIn
    }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  };
}

module.exports = {
  register,
  login
};
