// Camada Server
// Responsabilidade: validar o ambiente, ligar o servidor e desligá-lo com
// ordem quando o processo for encerrado.

// Atenção: nada de `require("./src/config/env")` aqui em cima. A validação do
// ambiente acontece no require, e ele precisa estar dentro do try/catch
// abaixo para que a falha vire uma mensagem legível em vez de stack trace.

function start() {
  let config;
  let app;

  try {
    // O require dispara a validação das variáveis de ambiente. Se faltar
    // JWT_SECRET (ou ele for curto demais), falha aqui — antes de aceitar
    // qualquer requisição. Sem essa validação, a API subiria normalmente e só
    // responderia 500, sem explicação, na primeira tentativa de login.
    config = require("./src/config/env");
    app = require("./src/app");
  } catch (error) {
    if (error.name === "EnvironmentError") {
      console.error(`\n[EasyFood] Não foi possível iniciar: ${error.message}\n`);
      process.exit(1);
    }

    throw error;
  }

  const server = app.listen(config.port, () => {
    console.log(`EasyFood rodando na porta ${config.port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `\n[EasyFood] A porta ${config.port} já está em uso. ` +
          `Encerre o outro processo ou defina outra porta com PORT=3001 npm start\n`
      );
      process.exit(1);
    }

    throw error;
  });

  // Encerramento ordenado: para de aceitar novas conexões antes de sair.
  const shutdown = (signal) => {
    console.log(`\n[EasyFood] Recebido ${signal}, encerrando...`);
    server.close(() => process.exit(0));
    // Se alguma conexão travar, não deixa o processo pendurado.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return server;
}

start();
