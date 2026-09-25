# 🍴 EasyFood API

![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-green)
![Node](https://img.shields.io/badge/node-20%2B-brightgreen)
![Testes](https://img.shields.io/badge/testes-104%20com%20node%20--test-blue)
[![CI](https://github.com/LucasF087/easyfood_api_lucasf/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasF087/easyfood_api_lucasf/actions/workflows/ci.yml)

API do projeto **EasyFood** — cadastro e consulta de restaurantes, com
autenticação de usuários via JWT e persistência em PostgreSQL usando Prisma.

Projeto desenvolvido ao longo das aulas de Arquitetura de Software (UniFECAF),
evoluindo em sprints:

| Sprint | Entrega |
|--------|---------|
| 1 | API inicial, dados em memória |
| 2 | Cadastro/consulta de restaurantes evoluído |
| 3 | Persistência real com PostgreSQL + Prisma |
| 4 | Refatoração para arquitetura em camadas |
| 5 | Autenticação de usuários com JWT |
| 6 | Versionamento no GitHub, documentação de arquitetura (C4) e decisão sobre eventos (ADR-005) |
| — | **Manutenção (set/2026):** robustez, validação, segurança e testes automatizados — ver [`docs/manutencao.md`](./docs/manutencao.md) |
| — | **Reforço de segurança e documentação (set/2026):** JWT em cookie httpOnly + CSRF (ADR-006), documentação OpenAPI/Swagger (`/docs`), escaneamento de segredos no CI e polish de UX no front-end |

O que cada missão entregou e em qual arquivo ela vive está em
[`docs/missoes.md`](./docs/missoes.md). As decisões arquiteturais estão em
[`docs/adr/`](./docs/adr/) e os diagramas em
[`docs/architecture/c4-model.md`](./docs/architecture/c4-model.md).

---

## 🖥️ Interface

> A captura abaixo é da versão anterior da interface — o visual foi refeito
> (busca por nome, ordenação, nova paleta), a captura ainda não. Rode o
> projeto localmente para ver a versão atual.

![Interface da EasyFood: lista de restaurantes com filtro por categoria](./docs/img/interface.png)

A interface (`public/`) é servida pelo próprio Express e consome a API por
URLs relativas:

- lista, busca por nome e ordena restaurantes (por nome ou avaliação), além
  de filtrar por categoria (`GET /restaurants`);
- aba **Perfil** com login e criação de conta (`POST /auth/login` e
  `POST /auth/register`);
- o token do login fica num **cookie httpOnly** (não em `sessionStorage`),
  enviado automaticamente pelo navegador; chamadas que mudam estado também
  enviam um token CSRF no header `X-CSRF-Token` — ver
  [ADR-006](./docs/adr/ADR-006-jwt-em-cookie-httponly.md);
- restaurantes cadastrados pela própria pessoa aparecem marcados e podem ser
  alterados ou excluídos (`PUT` e `DELETE /restaurants/:id`);
- qualquer resposta `401` encerra a sessão e leva para a tela de login.

---

## 📖 Documentação da API (Swagger)

Com o servidor rodando, a documentação interativa (OpenAPI 3) fica em:

- **http://localhost:3000/docs** — Swagger UI
- **http://localhost:3000/docs.json** — especificação bruta, em JSON

Pode ser desligada com `API_DOCS_ENABLED=false` (ver `.env.example`).

---

## 🧱 Stack

- [Node.js](https://nodejs.org/) 20+ e [Express 5](https://expressjs.com/)
- [PostgreSQL](https://www.postgresql.org/) + [Prisma ORM](https://www.prisma.io/)
- [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken), [bcryptjs](https://www.npmjs.com/package/bcryptjs) e [cookie-parser](https://www.npmjs.com/package/cookie-parser) para autenticação (JWT em cookie httpOnly + CSRF — [ADR-006](./docs/adr/ADR-006-jwt-em-cookie-httponly.md))
- [helmet](https://helmetjs.github.io/) e [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) para cabeçalhos de segurança e limite de tentativas
- [swagger-jsdoc](https://www.npmjs.com/package/swagger-jsdoc) e [swagger-ui-express](https://www.npmjs.com/package/swagger-ui-express) para a documentação OpenAPI em `/docs`
- HTML/CSS/JS puro na interface (`public/`)
- [Docker Compose](https://docs.docker.com/compose/) para o PostgreSQL de desenvolvimento
- `node --test` (embutido no Node) para a suíte de testes — sem dependências de teste
- [GitHub Actions](https://docs.github.com/actions) para integração contínua, incluindo escaneamento de segredos com [gitleaks](https://github.com/gitleaks/gitleaks)

---

## 📁 Estrutura do projeto

```
easyfood/
├── .github/
│   ├── workflows/ci.yml           # CI: build + banco (Postgres real) + seguranca (gitleaks)
│   └── pull_request_template.md
├── docs/
│   ├── adr/                       # Architecture Decision Records (001 a 006)
│   ├── architecture/c4-model.md   # diagramas C4: Contexto, Contêineres, Componentes e sequência
│   ├── img/interface.png
│   ├── manutencao.md              # auditoria de set/2026: o que mudou e por quê
│   └── missoes.md                 # cada missão da disciplina → arquivo que a implementa
├── prisma/
│   ├── migrations/                # 3 migrations, em ordem cronológica
│   ├── schema.prisma
│   └── seed.js                    # dados iniciais (idempotente)
├── public/
│   ├── css/styles.css             # apresentação
│   ├── js/app.js                  # comportamento (sem onclick nem style inline)
│   └── index.html                 # estrutura
├── scripts/
│   ├── prisma-check.js            # lê SHADOW_DATABASE_URL em JS (compatível com Windows)
│   └── smoke-test.sh              # smoke test de ponta a ponta contra uma API já rodando
├── src/
│   ├── app.js                     # trust proxy, /docs, helmet, CORS, cookies, JSON, rotas, erros
│   ├── config/
│   │   ├── env.js                 # carrega e VALIDA as variáveis de ambiente
│   │   └── swagger.js             # monta a especificação OpenAPI a partir das rotas
│   ├── database/prisma.js         # instância única do PrismaClient
│   ├── middlewares/
│   │   ├── error-handler.js       # 404 e erros sempre em JSON
│   │   ├── rate-limit.js          # limite de tentativas em /auth
│   │   └── request.js             # normaliza req.body, exige Content-Type JSON
│   ├── shared/
│   │   ├── cookies.js             # nomes/opções dos cookies de auth e CSRF (ADR-006)
│   │   ├── http-error.js          # erros que o cliente pode ver
│   │   ├── logger.js
│   │   └── validators.js          # regras de validação e normalização
│   └── modules/
│       ├── auth/                  # service, controller, middleware, csrf.middleware, routes
│       ├── health/health.routes.js
│       ├── notifications/         # cenário da ADR-005, simulado com log
│       └── restaurants/           # service, controller, routes (posse: só o dono altera/exclui)
├── tests/                          # suíte com node --test (sem banco), 104 casos
│   ├── helpers/                   # dublê do Prisma + servidor de teste (server.js)
│   ├── api.test.js  auth.test.js  cookies.test.js  cors.test.js  frontend.test.js
│   ├── env.test.js  notifications.test.js  rate-limit.test.js  restaurants.test.js
│   ├── schema.test.js  swagger.test.js     # schema.prisma × migrations SQL / spec OpenAPI
│   └── validators.test.js
├── docker-compose.yml
├── server.js                      # valida o ambiente e liga o servidor
├── .env.example  .gitattributes  .gitignore  .gitleaks.toml  LICENSE  package.json
```

**Fluxo de uma requisição:**

```
Cliente → app.js → routes → controller → service → database/prisma.js → PostgreSQL
                                             ↘ (erro) → error-handler → JSON
```

Cada camada tem uma responsabilidade única — a justificativa está na
[ADR-003](./docs/adr/ADR-003-arquitetura-em-camadas.md).

---

## 🚀 Como rodar o projeto

### Pré-requisitos

- [Node.js](https://nodejs.org/) 20+ (LTS)
- [Docker](https://www.docker.com/) (recomendado) **ou** um PostgreSQL acessível

### Passo a passo

```bash
# 1. Clone o repositório
git clone https://github.com/LucasF087/easyfood_api_lucasf.git
cd easyfood_api_lucasf

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env

# Gere um JWT_SECRET (mínimo de 32 bytes) e cole no .env:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Suba o PostgreSQL
docker compose up -d
# Sem Docker? Use um PostgreSQL seu e ajuste a DATABASE_URL no .env.

# 5. Rode as migrations
npx prisma migrate deploy

# 6. (Opcional) Popule o banco com restaurantes de exemplo
#    Pode ser rodado mais de uma vez: o seed é idempotente.
npm run prisma:seed

# 7. Suba o servidor
npm start
# desenvolvimento, com reinício automático:
npm run dev
```

A API sobe em `http://localhost:3000`, e a interface em
`http://localhost:3000/index.html`. Confirme que subiu:

```bash
curl http://localhost:3000/health
```

No Windows (PowerShell), os mesmos comandos funcionam — troque só a linha do
`node -e` por:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

(é a mesma linha; o `node -e` roda igual em qualquer terminal).

### Rodar os testes

```bash
npm test
```

104 casos com `node --test` (embutido no Node, sem dependência nova), sem
tocar em banco de dados — ver [`docs/manutencao.md`](./docs/manutencao.md#6-testes).

### Smoke test de ponta a ponta (com banco real)

Com a API já rodando (`npm start`) e o banco migrado:

```bash
BASE_URL=http://localhost:3000 bash scripts/smoke-test.sh
```

Requer `curl` e [`jq`](https://jqlang.org/). Cria dois usuários descartáveis,
cadastra, altera e exclui um restaurante, e confere as regras principais. É o
mesmo script que o job `banco` do CI roda contra um PostgreSQL de verdade.

### Verificar as migrations contra o schema (opcional)

```bash
# um banco vazio e descartável — NUNCA o de desenvolvimento
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/easyfood_shadow" npm run prisma:check
```

`tests/schema.test.js` já faz uma verificação equivalente sem precisar de
banco; este comando é o que o Prisma de fato usaria para aplicar as migrations
(ver [`docs/manutencao.md`](./docs/manutencao.md#7-consistência-entre-schema-e-migrations)).

---

## 🔑 Variáveis de ambiente

Veja `.env.example` para a lista completa e comentada. As obrigatórias:

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `DATABASE_URL` | ✅ | String de conexão do PostgreSQL |
| `JWT_SECRET` | ✅ | Mínimo 32 bytes. A API não sobe sem isso |
| `PORT` | | Porta da API (padrão `3000`) |
| `TRUST_PROXY` | | Proxies confiáveis à frente da API (deploy). Ver comentário no `.env.example` |
| `CORS_ORIGIN` | | Origens autorizadas por CORS. Vazio: libera tudo fora de produção, nada em produção |
| `RATE_LIMIT_*` | | Limite de tentativas em `/auth` (padrão: 20 a cada 15 min) |
| `SEED_DEMO_USER` | | `true` para o seed criar o usuário de demonstração (nunca em produção) |
| `COOKIE_SECURE` | | Cookie do JWT exige HTTPS. Liga sozinho em produção — ver [ADR-006](./docs/adr/ADR-006-jwt-em-cookie-httponly.md) |
| `API_DOCS_ENABLED` | | `false` desliga `/docs` e `/docs.json` (padrão: `true`) |
| `NOTIFICATIONS_*` | | Ver [ADR-005](./docs/adr/ADR-005-comunicacao-direta-sem-eventos.md) |

---

## 📡 Endpoints da API

### Restaurantes

| Método | Rota | Protegida? | Descrição |
|--------|------|:----------:|-----------|
| `GET`  | `/restaurants` | Não | Lista todos os restaurantes |
| `GET`  | `/restaurants/:id` | Não | Detalha um restaurante |
| `POST` | `/restaurants` | **Sim** | Cadastra um restaurante (você vira o dono) |
| `PUT`  | `/restaurants/:id` | **Sim** (dono) | Altera um restaurante seu. `rating` omitido mantém a nota atual |
| `DELETE` | `/restaurants/:id` | **Sim** (dono) | Exclui um restaurante seu |

`rating` vai de 0 a 5, com uma casa decimal. Restaurantes sem dono (do seed,
ou anteriores ao vínculo restaurante↔usuário) não podem ser alterados nem
excluídos por ninguém pela API.

### Autenticação

| Método | Rota | Protegida? | Descrição |
|--------|------|:----------:|-----------|
| `POST` | `/auth/register` | Não | Cria um novo usuário |
| `POST` | `/auth/login` | Não | Autentica; devolve um token JWT **e** grava os cookies de sessão (ver abaixo) |
| `POST` | `/auth/logout` | Não | Apaga os cookies de sessão. Idempotente |
| `GET`  | `/auth/me` | **Sim** | Retorna os dados do usuário autenticado |

**Duas formas de autenticar**, aceitas por qualquer rota protegida (ver
[ADR-006](./docs/adr/ADR-006-jwt-em-cookie-httponly.md)):

1. **Header `Authorization: Bearer <token>`** — para Postman, curl, apps
   mobile, scripts. Não precisa de header CSRF.
2. **Cookie httpOnly** (o que o front-end de `public/` usa) — gravado
   automaticamente pelo navegador no login. Toda chamada `POST`/`PUT`/`DELETE`
   autenticada por cookie precisa também do header `X-CSRF-Token`, com o
   valor do cookie (legível) `easyfood_csrf` — sem isso, a API responde `403`.

### Operação

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | `{ "status": "ok" }` — usado por deploy e pelo smoke test |
| `GET` | `/docs` | Documentação interativa da API (Swagger UI) |
| `GET` | `/docs.json` | Especificação OpenAPI 3, em JSON |

### Exemplos rápidos

```bash
# Criar conta
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Aluno","email":"aluno@easyfood.com","password":"123456"}'

# Login (via header — para Postman, curl, scripts)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"aluno@easyfood.com","password":"123456"}'
# -> { "token": "...", "user": { "id": 1, ... } }

# Cadastrar um restaurante (troque <token> pelo valor acima)
curl -X POST http://localhost:3000/restaurants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"Cantina Roma","category":"Italiana","rating":4.5}'
```

```bash
# Mesmo fluxo, mas via cookie (como o front-end faz) — precisa de um
# "cookie jar" (-c/-b) e do header X-CSRF-Token:
curl -c cookies.txt -b cookies.txt -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"aluno@easyfood.com","password":"123456"}'

CSRF=$(grep easyfood_csrf cookies.txt | awk '{print $7}')

curl -c cookies.txt -b cookies.txt -X POST http://localhost:3000/restaurants \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"Cantina Roma","category":"Italiana","rating":4.5}'
```

---

## 📋 Códigos de resposta

| Código | Quando acontece |
|--------|------------------|
| `200` | Requisição bem-sucedida (GET, PUT) |
| `201` | Recurso criado (registro, login, cadastro de restaurante) |
| `204` | Excluído com sucesso, sem corpo na resposta |
| `400` | Dados inválidos — o corpo traz `{ "error": "...", "details": [...] }` |
| `401` | Sem token, token inválido/expirado, ou credenciais erradas no login |
| `403` | Autenticado, mas não é o dono do restaurante |
| `404` | Rota ou recurso inexistente |
| `409` | E-mail já cadastrado |
| `413` | Corpo da requisição maior que o limite (`BODY_LIMIT`) |
| `415` | `Content-Type` diferente de `application/json` |
| `429` | Rate limit excedido em `/auth` |
| `500` | Erro inesperado — o cliente recebe uma mensagem genérica; o detalhe vai só para o log do servidor |

---

## 🧯 Problemas comuns

**`the URL must start with the protocol postgresql://`**
A `DATABASE_URL` do `.env` está vazia ou mal formada. Confira contra o
`.env.example`.

**A API não sobe, e o terminal mostra `JWT_SECRET` na mensagem**
`JWT_SECRET` está ausente ou tem menos de 32 bytes. A própria mensagem sugere
o comando para gerar um valor válido.

**`ECONNREFUSED` ao rodar `npx prisma migrate deploy`**
O PostgreSQL não está no ar. Rode `docker compose up -d` (ou confira o seu
banco) e tente de novo.

**Erro de `permission denied` ou porta em uso ao rodar `docker compose up -d`**
Outro serviço já está usando a porta 5432. Suba com outra porta:
`POSTGRES_PORT=5433 docker compose up -d` e ajuste a `DATABASE_URL`.

**Em produção (Render, Railway, atrás de um proxy), o rate limit bloqueia todo mundo junto**
Falta `TRUST_PROXY`. Sem ele, a API vê o IP do proxy, não o do cliente, e
todo mundo cai no mesmo contador. Defina `TRUST_PROXY` com o número de
proxies à frente da API (normalmente `1`).

**A interface não consegue chamar a API quando aberta por outra origem**
Em produção, sem `CORS_ORIGIN`, a API não envia cabeçalhos CORS — só a mesma
origem funciona. Publicando a interface em outro domínio, informe
`CORS_ORIGIN` com esse domínio.

**Abri `public/index.html` direto pelo Live Server (ou dando duplo clique) e nada funciona**
A interface espera ser servida pelo próprio Express, na mesma origem da API.
Acesse por `http://localhost:3000`, não por outra porta.

---

## ⚠️ Limitações conhecidas

- **`npm audit`** aponta 3 vulnerabilidades altas na cadeia `prisma` →
  `@prisma/config` → `deepmerge-ts`, sem correção não-breaking hoje. Detalhes
  em [`docs/manutencao.md`](./docs/manutencao.md#8-npm-audit).
- **Sem paginação:** `GET /restaurants` devolve a lista inteira. Aceitável no
  volume de um projeto de disciplina; não usar como está com muitos registros.
- **Sem refresh token:** o JWT expira (`JWT_EXPIRES_IN`, padrão 1 dia) e a
  pessoa precisa logar de novo. Não há renovação automática. Isso vale mesmo
  com o cookie: como o JWT continua stateless, `POST /auth/logout` apaga o
  cookie no navegador, mas não revoga o valor do token em si (ver
  [ADR-006](./docs/adr/ADR-006-jwt-em-cookie-httponly.md#negativas)).
- **Um único usuário demo, opcional:** `SEED_DEMO_USER=true` cria
  `demo@easyfood.local` / `easyfood123`. A senha é pública; nunca ligue essa
  variável em um banco publicado.
- **CI:** o job `build` valida o schema com um banco de mentira (o Prisma
  Client é substituído por um dublê nos testes) e o job `banco` roda as
  migrations e o smoke test contra um PostgreSQL de verdade. Nenhum dos dois
  substitui testar manualmente antes de apresentar.
- **Sem CDN/armazenamento de imagens:** não há upload de foto de restaurante.
- **Captura de tela desatualizada:** a imagem em `docs/img/interface.png`
  ainda é da interface anterior ao polish de UX (busca, ordenação, nova
  paleta) — ver "Próximos passos".

---

## 📓 Decisões de arquitetura (ADRs)

| ADR | Decisão |
|-----|---------|
| [001](./docs/adr/ADR-001-armazenar-restaurantes-em-memoria.md) | Armazenar restaurantes em memória (versão inicial, superada) |
| [002](./docs/adr/ADR-002-persistencia-com-postgresql.md) | Adotar PostgreSQL como banco de dados |
| [003](./docs/adr/ADR-003-arquitetura-em-camadas.md) | Reorganizar o monólito em arquitetura de camadas |
| [004](./docs/adr/ADR-004-autenticacao-com-jwt.md) | Autenticação com JWT |
| [005](./docs/adr/ADR-005-comunicacao-direta-sem-eventos.md) | Manter comunicação direta entre módulos, sem arquitetura orientada a eventos por ora |
| [006](./docs/adr/ADR-006-jwt-em-cookie-httponly.md) | JWT em cookie httpOnly + defesa CSRF, no lugar de `sessionStorage` |

---

## ✅ Integração contínua

O workflow [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) roda a
cada push na `main` e em pull requests, em três jobs:

1. **`build`** (Node 20 e 22): instala as dependências, valida o schema do
   Prisma, checa a sintaxe, valida o `docker-compose.yml`, roda os 104 testes
   (sem banco) e reporta o `npm audit` (informativo).
2. **`banco`** (depois do `build`, com um serviço PostgreSQL): aplica as
   migrations (`prisma migrate deploy`), confere schema × banco
   (`prisma:check`), roda o seed duas vezes seguidas — confirmando que é
   idempotente — sobe a API de verdade e roda o
   [smoke test](./scripts/smoke-test.sh) de ponta a ponta.
3. **`seguranca`** (em paralelo, não depende do `build`): escaneia todo o
   histórico do repositório atrás de segredos commitados, com
   [gitleaks](https://github.com/gitleaks/gitleaks). A configuração
   (`.gitleaks.toml`) documenta os únicos falsos positivos conhecidos
   (fixtures de teste e a senha pública do seed de demonstração).

---

## 🗂️ Sobre o histórico do Git

Este repositório contém a versão atual do projeto e o histórico Git correspondente
às alterações realizadas neste repositório. As decisões e pontos de manutenção
documentados no projeto estão registrados em [`docs/manutencao.md`](./docs/manutencao.md).
Quando utilizados, os commits seguem prefixos (`feat`, `fix`, `docs`, `test`,
`chore`) no estilo do [Conventional Commits](https://www.conventionalcommits.org/pt-br/).

---

## 🗺️ Próximos passos (2ª entrega)

- Paginação em `GET /restaurants`
- Testes end-to-end com PostgreSQL real também no PR (hoje só na branch,
  via job `banco`)
- Avaliar a migração para o Prisma 7 (resolveria as vulnerabilidades do
  `npm audit`; decisão arquitetural, exige um ADR novo)
- Deploy (Render, Railway ou similar) — ajustar `TRUST_PROXY` e `CORS_ORIGIN`
  ao provedor escolhido
- Refresh token, para não exigir login de novo a cada expiração do JWT
- Atualizar `docs/img/interface.png` para o visual atual da interface

---

## 📄 Licença

Distribuído sob a licença MIT. Veja o arquivo [`LICENSE`](./LICENSE).

## 👤 Autor e créditos

Desenvolvido por **Lucas Ferreira da Silva** na disciplina de Arquitetura de
Software & Design Patterns (UniFECAF). O roteiro das missões e o
projeto-base da interface vêm do material da disciplina.
