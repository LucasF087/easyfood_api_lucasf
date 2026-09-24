// Camada Shared
// Responsabilidade: um único lugar para escrever log no servidor.
//
// Mantido propositalmente pequeno (sem dependências): o objetivo é que o
// detalhe técnico de um erro apareça no terminal do servidor e nunca na
// resposta HTTP enviada ao cliente.

// LOG_LEVEL=silent desliga a saída. Usado pelos testes automatizados, para
// que a saída do `node --test` mostre os testes e não o log da aplicação.
// Lido a cada chamada, e não no carregamento do módulo, para poder ser
// ligado e desligado dentro de um mesmo processo.
function isSilent() {
  return String(process.env.LOG_LEVEL ?? "").trim().toLowerCase() === "silent";
}

function timestamp() {
  return new Date().toISOString();
}

function format(level, message, meta) {
  const base = `${timestamp()} [${level}] ${message}`;

  if (meta === undefined || meta === null) {
    return base;
  }

  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch {
    return `${base} [meta não serializável]`;
  }
}

const logger = {
  info(message, meta) {
    if (isSilent()) return;
    console.log(format("info", message, meta));
  },

  warn(message, meta) {
    if (isSilent()) return;
    console.warn(format("warn", message, meta));
  },

  error(message, meta) {
    if (isSilent()) return;
    console.error(format("error", message, meta));
  }
};

module.exports = logger;
