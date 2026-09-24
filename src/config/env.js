// Camada Config
// Responsabilidade: carregar, validar e congelar as variáveis de ambiente.
//
// A validação acontece no momento em que este módulo é carregado, antes de
// qualquer rota existir. Se algo obrigatório estiver faltando, a aplicação
// falha imediatamente com uma mensagem clara — em vez de subir e só quebrar
// com 500 na primeira tentativa de login.

require("dotenv").config();

// Tamanho mínimo do segredo do JWT, em bytes.
// 32 bytes é o tamanho do bloco do HMAC-SHA256: segredos menores não
// aumentam a segurança da assinatura.
const MIN_JWT_SECRET_BYTES = 32;

// Algoritmo único aceito para assinar e validar tokens.
// Fixar o algoritmo evita o ataque clássico de trocar o "alg" do token
// (por exemplo para "none") na hora da validação.
const JWT_ALGORITHM = "HS256";

class EnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvironmentError";
  }
}

function readString(name, { required = false, fallback = "" } = {}) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    if (required) {
      throw new EnvironmentError(
        `a variável de ambiente ${name} é obrigatória e não está definida. ` +
          `Copie o arquivo .env.example para .env e preencha os valores.`
      );
    }
    return fallback;
  }

  return String(raw).trim();
}

function readInteger(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new EnvironmentError(
      `a variável de ambiente ${name} deve ser um número inteiro não negativo (recebido: "${raw}").`
    );
  }

  return parsed;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();

  if (["1", "true", "yes", "sim", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "nao", "não", "off"].includes(normalized)) return false;

  throw new EnvironmentError(
    `a variável de ambiente ${name} deve ser true ou false (recebido: "${raw}").`
  );
}

function readJwtSecret() {
  const secret = readString("JWT_SECRET", { required: true });
  const bytes = Buffer.byteLength(secret, "utf8");

  if (bytes < MIN_JWT_SECRET_BYTES) {
    throw new EnvironmentError(
      `JWT_SECRET precisa ter pelo menos ${MIN_JWT_SECRET_BYTES} bytes ` +
        `(o valor atual tem ${bytes}). Gere um segredo com:\n` +
        `  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
    );
  }

  return secret;
}

// Quantos proxies confiáveis existem entre o cliente e a API (Render, Railway,
// Fly, Nginx...). Atrás de um proxy, o IP que o Express enxerga é o do próprio
// proxy: sem TRUST_PROXY, o limite de tentativas de /auth vira um contador
// único para todos os usuários. Sem proxy (desenvolvimento local), deixe vazio.
//
//   vazio ou 0  -> não confia em nenhum proxy (padrão)
//   1, 2, ...   -> número de proxies confiáveis à frente da API
//   "loopback, 10.0.0.0/8" -> lista de endereços/sub-redes aceita pelo Express
//
// "true" é recusado de propósito: confiar em qualquer X-Forwarded-For deixa o
// cliente escolher o próprio IP e anula o rate limit.
function readTrustProxy() {
  const raw = readString("TRUST_PROXY", { fallback: "" });

  if (raw === "" || raw.toLowerCase() === "false") return false;

  if (raw.toLowerCase() === "true") {
    throw new EnvironmentError(
      "TRUST_PROXY=true não é aceito: qualquer cliente poderia forjar o próprio IP " +
        "no cabeçalho X-Forwarded-For e escapar do limite de tentativas. " +
        "Informe o número de proxies (por exemplo, TRUST_PROXY=1)."
    );
  }

  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return hops === 0 ? false : hops;
  }

  return raw;
}

// Origens autorizadas a chamar a API a partir de outro site (CORS).
//
//   vazio, fora de produção -> "*" (qualquer origem; conveniente em desenvolvimento)
//   vazio, em produção      -> false (nenhum cabeçalho CORS: só a mesma origem)
//   "*"                     -> qualquer origem
//   "https://a.com,https://b.com" -> apenas essas origens
//
// A interface é servida pelo próprio Express (mesma origem), então em produção
// normalmente não é preciso liberar nada.
function readCorsOrigin(nodeEnv) {
  const raw = readString("CORS_ORIGIN", { fallback: "" });

  if (raw === "") return nodeEnv === "production" ? false : "*";
  if (raw === "*") return "*";

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    if (!/^https?:\/\/[^\s/,]+$/i.test(origin)) {
      throw new EnvironmentError(
        `CORS_ORIGIN contém um valor inválido: "${origin}". ` +
          `Use apenas esquema e host, sem barra no final ` +
          `(por exemplo: https://easyfood.exemplo.com).`
      );
    }
  }

  return origins;
}

const nodeEnv = readString("NODE_ENV", { fallback: "development" });

const config = Object.freeze({
  nodeEnv,
  port: readInteger("PORT", 3000),

  // Cookie do JWT (ver docs/adr/ADR-006-jwt-em-cookie-httponly.md): "secure"
  // exige HTTPS, então só liga sozinho em produção. Em desenvolvimento local
  // (http://localhost) um cookie "secure" nunca seria enviado pelo navegador.
  cookies: Object.freeze({
    secure: readBoolean("COOKIE_SECURE", nodeEnv === "production")
  }),

  apiDocs: Object.freeze({
    enabled: readBoolean("API_DOCS_ENABLED", true)
  }),

  jwt: Object.freeze({
    secret: readJwtSecret(),
    algorithm: JWT_ALGORITHM,
    expiresIn: readString("JWT_EXPIRES_IN", { fallback: "1d" })
  }),

  // Limite do corpo das requisições. Protege contra payloads enormes
  // (a API só recebe JSON pequeno).
  bodyLimit: readString("BODY_LIMIT", { fallback: "100kb" }),

  // Rate limit aplicado às rotas de autenticação (/auth).
  rateLimit: Object.freeze({
    enabled: readBoolean("RATE_LIMIT_ENABLED", true),
    windowMs: readInteger("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
    max: readInteger("RATE_LIMIT_MAX", 20)
  }),

  trustProxy: readTrustProxy(),

  cors: Object.freeze({
    origin: readCorsOrigin(nodeEnv)
  }),

  MIN_JWT_SECRET_BYTES,
  EnvironmentError
});

module.exports = config;
module.exports.EnvironmentError = EnvironmentError;
