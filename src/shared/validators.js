// Camada Shared
// Responsabilidade: normalizar e validar a entrada antes de ela chegar ao
// Service e ao banco.
//
// Por que aqui e não no Controller: as mesmas regras valem para /auth e para
// /restaurants, e os limites (tamanho de coluna, faixa do rating) vêm do
// schema do Prisma. Centralizar evita que cada rota invente a sua própria
// checagem.
//
// Limites espelhados de prisma/schema.prisma:
//   User.name       VarChar(150)
//   User.email      VarChar(150)  @unique
//   User.password   VarChar(255)  (guarda o hash, não a senha)
//   Restaurant.name VarChar(150)
//   Restaurant.category VarChar(100)
//   Restaurant.rating   Decimal(2,1)  -> 0.0 a 9.9 no banco; a regra de
//                                        negócio (e a interface) é 0 a 5

const LIMITS = Object.freeze({
  NAME_MAX: 150,
  EMAIL_MAX: 150,
  CATEGORY_MAX: 100,
  RESTAURANT_NAME_MAX: 150,
  PASSWORD_MIN_CHARS: 6,
  // bcrypt só considera os primeiros 72 bytes da senha. Aceitar mais que isso
  // daria a falsa impressão de que a senha inteira está protegida.
  PASSWORD_MAX_BYTES: 72,
  RATING_MIN: 0,
  RATING_MAX: 5,
  RATING_DECIMALS: 1
});

// Formato de e-mail: parte local sem espaços, arroba, domínio com pelo menos
// um ponto. Propositalmente simples — validação definitiva de e-mail só
// acontece enviando uma mensagem para ele.
const EMAIL_PATTERN = /^[^\s@<>"'`\\]+@[^\s@<>"'`\\.]+(\.[^\s@<>"'`\\.]+)+$/;

function isString(value) {
  return typeof value === "string";
}

// Normaliza o e-mail: remove espaços nas pontas e baixa a caixa.
// Sem isso, "Ana@x.com" e "ana@x.com" criam duas contas diferentes e o login
// falha dependendo de como a pessoa digitou.
function normalizeEmail(value) {
  return isString(value) ? value.trim().toLowerCase() : value;
}

function validateName(value, errors, { field = "name", label = "Nome", max = LIMITS.NAME_MAX } = {}) {
  if (value === undefined || value === null || value === "") {
    errors.push(`${label} é obrigatório`);
    return undefined;
  }

  if (!isString(value)) {
    errors.push(`${label} deve ser um texto`);
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    errors.push(`${label} é obrigatório`);
    return undefined;
  }

  if (trimmed.length > max) {
    errors.push(`${label} deve ter no máximo ${max} caracteres`);
    return undefined;
  }

  return { field, value: trimmed };
}

function validateEmail(value, errors) {
  if (value === undefined || value === null || value === "") {
    errors.push("E-mail é obrigatório");
    return undefined;
  }

  if (!isString(value)) {
    errors.push("E-mail deve ser um texto");
    return undefined;
  }

  const normalized = normalizeEmail(value);

  if (normalized.length === 0) {
    errors.push("E-mail é obrigatório");
    return undefined;
  }

  if (normalized.length > LIMITS.EMAIL_MAX) {
    errors.push(`E-mail deve ter no máximo ${LIMITS.EMAIL_MAX} caracteres`);
    return undefined;
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    errors.push("E-mail em formato inválido");
    return undefined;
  }

  return { field: "email", value: normalized };
}

function validatePassword(value, errors) {
  if (value === undefined || value === null || value === "") {
    errors.push("Senha é obrigatória");
    return undefined;
  }

  if (!isString(value)) {
    errors.push("Senha deve ser um texto");
    return undefined;
  }

  if (value.length < LIMITS.PASSWORD_MIN_CHARS) {
    errors.push(`Senha deve ter pelo menos ${LIMITS.PASSWORD_MIN_CHARS} caracteres`);
    return undefined;
  }

  const bytes = Buffer.byteLength(value, "utf8");

  if (bytes > LIMITS.PASSWORD_MAX_BYTES) {
    errors.push(
      `Senha deve ter no máximo ${LIMITS.PASSWORD_MAX_BYTES} bytes ` +
        `(acentos e emojis ocupam mais de um byte; a senha enviada tem ${bytes})`
    );
    return undefined;
  }

  // A senha não é aparada: espaço no começo ou no fim faz parte da senha.
  return { field: "password", value };
}

// Senha no LOGIN: só o formato importa. As regras de tamanho valem para quem
// cria a senha (cadastro). Aplicá-las aqui responderia 400 — e revelaria a
// política de senha — em vez de 401 para uma senha errada, e trancaria contas
// criadas antes de a regra existir.
function validateLoginPassword(value, errors) {
  if (value === undefined || value === null || value === "") {
    errors.push("Senha é obrigatória");
    return undefined;
  }

  if (!isString(value)) {
    errors.push("Senha deve ser um texto");
    return undefined;
  }

  return { field: "password", value };
}

// rating é opcional. Ausente vira 0 no cadastro (POST). Na alteração (PUT),
// `keepWhenMissing` tira o campo do resultado e o valor atual é mantido.
// Aceita número ou string numérica ("4.5" vindo de um formulário).
function validateRating(value, errors, { keepWhenMissing = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return keepWhenMissing ? undefined : { field: "rating", value: 0 };
  }

  if (typeof value === "boolean") {
    errors.push("Avaliação deve ser um número");
    return undefined;
  }

  if (!isString(value) && typeof value !== "number") {
    errors.push("Avaliação deve ser um número");
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));

  if (!Number.isFinite(parsed)) {
    errors.push("Avaliação deve ser um número");
    return undefined;
  }

  if (parsed < LIMITS.RATING_MIN || parsed > LIMITS.RATING_MAX) {
    errors.push(`Avaliação deve estar entre ${LIMITS.RATING_MIN} e ${LIMITS.RATING_MAX}`);
    return undefined;
  }

  // Decimal(2,1) guarda uma casa decimal. Arredondar aqui, de forma explícita,
  // evita que o banco faça isso silenciosamente (ou estoure o campo).
  const rounded = Number(parsed.toFixed(LIMITS.RATING_DECIMALS));

  return { field: "rating", value: rounded };
}

// Valida o :id da URL. Precisa ser inteiro positivo — "abc" ou "1.5" nunca
// devem chegar ao Prisma (lá viram erro 500).
function validateId(value, errors, label = "id") {
  const raw = String(value ?? "").trim();

  if (!/^[0-9]+$/.test(raw)) {
    errors.push(`O ${label} deve ser um número inteiro positivo`);
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors.push(`O ${label} deve ser um número inteiro positivo`);
    return undefined;
  }

  return { field: label, value: parsed };
}

function collect(results) {
  const data = {};

  for (const result of results) {
    if (result) {
      data[result.field] = result.value;
    }
  }

  return data;
}

function validateRegister(payload = {}) {
  const errors = [];

  const data = collect([
    validateName(payload.name, errors),
    validateEmail(payload.email, errors),
    validatePassword(payload.password, errors)
  ]);

  return { data, errors };
}

function validateLogin(payload = {}) {
  const errors = [];

  const data = collect([
    validateEmail(payload.email, errors),
    validateLoginPassword(payload.password, errors)
  ]);

  return { data, errors };
}

// isUpdate: no PUT, a nota omitida mantém o valor atual (no POST ela vira 0).
function validateRestaurant(payload = {}, { isUpdate = false } = {}) {
  const errors = [];

  const data = collect([
    validateName(payload.name, errors, {
      field: "name",
      label: "Nome do restaurante",
      max: LIMITS.RESTAURANT_NAME_MAX
    }),
    validateName(payload.category, errors, {
      field: "category",
      label: "Categoria",
      max: LIMITS.CATEGORY_MAX
    }),
    validateRating(payload.rating, errors, { keepWhenMissing: isUpdate })
  ]);

  return { data, errors };
}

module.exports = {
  LIMITS,
  EMAIL_PATTERN,
  isString,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateLoginPassword,
  validateRating,
  validateId,
  validateRegister,
  validateLogin,
  validateRestaurant
};
