#!/usr/bin/env bash
# Smoke test de ponta a ponta contra uma API que JÁ está rodando, com banco real.
#
# Uso:
#   BASE_URL=http://localhost:3000 bash scripts/smoke-test.sh
#
# Requisitos: bash, curl e jq. No Windows, rode pelo Git Bash ou pelo WSL.
#
# O que faz: cria dois usuários descartáveis (e-mails aleatórios em
# example.com), cadastra, altera e exclui um restaurante, e confere as regras
# principais (token, posse, PUT que mantém a nota, 401 no login errado).
# O restaurante é excluído no fim, mas não existe rota para apagar usuários:
# os dois permanecem no banco. Rode contra um banco de teste.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SUFIXO="$(date +%s)-${RANDOM}"
EMAIL_DONO="smoke-dono-${SUFIXO}@example.com"
EMAIL_OUTRO="smoke-outro-${SUFIXO}@example.com"
SENHA="senha-de-smoke-123"

falhar() {
  echo "FALHOU: $*" >&2
  exit 1
}

# request MÉTODO CAMINHO [TOKEN] [CORPO_JSON]
# Imprime o corpo da resposta e, na última linha, o status HTTP.
request() {
  local metodo="$1" caminho="$2" token="${3:-}" corpo="${4:-}"
  local args=(-sS -X "$metodo" "${BASE_URL}${caminho}" -w $'\n%{http_code}')

  if [ -n "$token" ]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi

  if [ -n "$corpo" ]; then
    args+=(-H "Content-Type: application/json" -d "$corpo")
  fi

  curl "${args[@]}"
}

status_de() { printf '%s' "${1##*$'\n'}"; }
corpo_de() { printf '%s' "${1%$'\n'*}"; }
campo_de() { corpo_de "$1" | jq -r "$2"; }

esperar() {
  local esperado="$1" resposta="$2" descricao="$3"
  local status
  status="$(status_de "$resposta")"

  if [ "$status" != "$esperado" ]; then
    falhar "${descricao}: esperado HTTP ${esperado}, recebido ${status} — $(corpo_de "$resposta")"
  fi

  echo "ok  ${status}  ${descricao}"
}

exigir() {
  local obtido="$1" esperado="$2" descricao="$3"

  if [ "$obtido" != "$esperado" ]; then
    falhar "${descricao}: esperado '${esperado}', obtido '${obtido}'"
  fi

  echo "ok       ${descricao}"
}

corpo_registro() {
  jq -nc --arg name "$1" --arg email "$2" --arg password "$SENHA" \
    '{name: $name, email: $email, password: $password}'
}

corpo_login() {
  jq -nc --arg email "$1" --arg password "$2" '{email: $email, password: $password}'
}

entrar() {
  local email="$1" resposta
  resposta="$(request POST /auth/login "" "$(corpo_login "$email" "$SENHA")")"
  esperar 200 "$resposta" "POST /auth/login (${email})" >&2
  campo_de "$resposta" '.token'
}

echo "Smoke test contra ${BASE_URL}"

# --- rotas públicas ---------------------------------------------------------
resposta="$(request GET /health)"
esperar 200 "$resposta" "GET /health"

resposta="$(request GET /restaurants)"
esperar 200 "$resposta" "GET /restaurants (público)"
exigir "$(campo_de "$resposta" 'type')" "array" "GET /restaurants devolve uma lista"

# --- cadastro e login -------------------------------------------------------
resposta="$(request POST /auth/register "" "$(corpo_registro Dono "$EMAIL_DONO")")"
esperar 201 "$resposta" "POST /auth/register (dono)"

resposta="$(request POST /auth/register "" "$(corpo_registro Outro "$EMAIL_OUTRO")")"
esperar 201 "$resposta" "POST /auth/register (outro usuário)"

resposta="$(request POST /auth/register "" "$(corpo_registro Dono "$EMAIL_DONO")")"
esperar 409 "$resposta" "POST /auth/register com e-mail repetido"

# Senha errada e curta: tem de ser 401 (e não 400, que revelaria a política de senha).
resposta="$(request POST /auth/login "" "$(corpo_login "$EMAIL_DONO" "12345")")"
esperar 401 "$resposta" "POST /auth/login com senha errada e curta"

TOKEN_DONO="$(entrar "$EMAIL_DONO")"
TOKEN_OUTRO="$(entrar "$EMAIL_OUTRO")"

if [ -z "$TOKEN_DONO" ] || [ "$TOKEN_DONO" = "null" ]; then
  falhar "o login não devolveu token"
fi

resposta="$(request GET /auth/me "$TOKEN_DONO")"
esperar 200 "$resposta" "GET /auth/me com token"

# --- restaurantes -----------------------------------------------------------
NOVO='{"name":"Smoke Grill","category":"Burger","rating":4.4}'

resposta="$(request POST /restaurants "" "$NOVO")"
esperar 401 "$resposta" "POST /restaurants sem token"

resposta="$(request POST /restaurants "$TOKEN_DONO" "$NOVO")"
esperar 201 "$resposta" "POST /restaurants com token"
ID="$(campo_de "$resposta" '.id')"
exigir "$(campo_de "$resposta" '.rating')" "4.4" "a nota volta como string com uma casa decimal"

if [ "$(campo_de "$resposta" '.userId')" = "null" ]; then
  falhar "o restaurante deveria ter um dono (userId)"
fi

# PUT sem a nota: o nome muda e a nota é mantida.
resposta="$(request PUT "/restaurants/${ID}" "$TOKEN_DONO" '{"name":"Smoke Grill 2","category":"Burger"}')"
esperar 200 "$resposta" "PUT /restaurants/${ID} sem rating"
exigir "$(campo_de "$resposta" '.name')" "Smoke Grill 2" "o PUT alterou o nome"
exigir "$(campo_de "$resposta" '.rating')" "4.4" "o PUT sem rating manteve a nota"

resposta="$(request GET "/restaurants/${ID}")"
esperar 200 "$resposta" "GET /restaurants/${ID}"
exigir "$(campo_de "$resposta" '.name')" "Smoke Grill 2" "o GET devolve o nome alterado"

resposta="$(request DELETE "/restaurants/${ID}" "$TOKEN_OUTRO")"
esperar 403 "$resposta" "DELETE por outro usuário"

resposta="$(request DELETE "/restaurants/${ID}" "$TOKEN_DONO")"
esperar 204 "$resposta" "DELETE pelo dono"

resposta="$(request GET "/restaurants/${ID}")"
esperar 404 "$resposta" "GET de restaurante excluído"

echo "Smoke test concluído: tudo certo."
