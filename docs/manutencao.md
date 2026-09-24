# Manutenção de setembro/2026 — auditoria e correções

Este documento registra o que foi encontrado em auditorias sucessivas da V1 (a
versão entregue na Aula 6, marcada pela tag [`v1.0.0`](#histórico-do-git)) e o
que foi feito a respeito. A ideia é que qualquer pessoa consiga conferir cada
item: para cada problema há o arquivo que o corrigiu e o teste que garante que
ele não volta.

Rode `npm test` para ver os 104 casos passando.

---

## 1. Robustez da API

| # | Problema na V1 | Correção | Onde | Teste |
|---|----------------|----------|------|-------|
| 1.1 | `POST` sem corpo devolvia **500 em HTML com stack trace**, expondo caminhos do servidor | `req.body` é normalizado para `{}` e a validação responde 400 | [`src/middlewares/request.js`](../src/middlewares/request.js), controllers | `POST sem body devolve 400 em JSON` |
| 1.2 | JSON malformado caía na página de erro do Express (HTML + stack) | erro `entity.parse.failed` traduzido para 400 JSON | [`src/middlewares/error-handler.js`](../src/middlewares/error-handler.js) | `POST com JSON malformado devolve 400 em JSON` |
| 1.3 | Rota inexistente devolvia 404 em HTML | handler de 404 em JSON, registrado depois de todas as rotas | [`src/app.js`](../src/app.js) | `rota inexistente devolve 404 em JSON` |
| 1.4 | Header `X-Powered-By: Express` exposto | `app.disable("x-powered-by")` + `helmet` | [`src/app.js`](../src/app.js) | `o header X-Powered-By não é enviado em nenhuma resposta` |
| 1.5 | Sem limite de tamanho de corpo | `express.json({ limit: "100kb" })`, configurável por `BODY_LIMIT` | [`src/app.js`](../src/app.js) | `corpo acima do limite de 100kb devolve 413` |

**Regra adotada:** o cliente recebe sempre uma resposta JSON controlada; o
detalhe técnico (mensagem, código e stack) vai apenas para o log do servidor.
Isso vale para os cinco casos: rota inexistente, erro de validação, JSON
inválido, erro conhecido do Prisma e erro inesperado.

O teste `o stack trace do erro 500 vai para o log do servidor, nunca para o
cliente` captura a saída do `console.error` e verifica os dois lados da regra
ao mesmo tempo: a mensagem sensível aparece no log e **não** aparece no corpo
da resposta.

---

## 2. Validação de entrada

Na V1 a validação era `if (!name || !email || !password)`. Problemas que isso
deixava passar:

| # | Problema | Correção |
|---|----------|----------|
| 2.1 | `Ana@x.com` e `ana@x.com` viravam contas diferentes | `trim().toLowerCase()` antes de gravar e de consultar |
| 2.2 | Qualquer texto era aceito como e-mail | validação de formato (parte local, arroba, domínio com ponto) |
| 2.3 | Senha de 1 caractere era aceita | mínimo de 6 caracteres |
| 2.4 | Senha acima de 72 bytes era silenciosamente truncada pelo bcrypt | limite de 72 **bytes** (acento e emoji ocupam mais de um byte) |
| 2.5 | `typeof` não era checado — `{"password": ["123456"]}` chegava ao bcrypt | todo campo de texto exige `typeof === "string"` |
| 2.6 | `rating: 7` era aceito, apesar da interface dizer 0–5 | faixa 0 a 5 validada no servidor |
| 2.7 | `rating: 10` estourava o `Decimal(2,1)` e virava 500 | recusado com 400, antes de chegar ao banco |
| 2.8 | `rating: 4.26` era arredondado silenciosamente pelo PostgreSQL | arredondado de forma explícita para uma casa decimal |
| 2.9 | `/restaurants/abc` chegava ao Prisma e virava 500 | `:id` precisa ser inteiro positivo |
| 2.10 | login com senha curta devolvia **400** ("mínimo de 6 caracteres"), revelando a política de senha e travando o login de contas criadas antes da regra existir | login usa `validateLoginPassword` (só exige texto não vazio); as regras de tamanho valem apenas no cadastro. Senha errada, seja qual for o tamanho, é sempre 401 |

Tudo isso vive em [`src/shared/validators.js`](../src/shared/validators.js), com
os limites espelhados das colunas do `schema.prisma` (`VarChar(150)`,
`VarChar(100)`, `Decimal(2,1)`). Testes: `tests/validators.test.js`,
`tests/auth.test.js` e `tests/restaurants.test.js`.

---

## 3. JWT

| # | Problema | Correção |
|---|----------|----------|
| 3.1 | Sem `JWT_SECRET`, a API subia normalmente e devolvia 500 sem explicação no primeiro login | [`src/config/env.js`](../src/config/env.js) valida no carregamento; o processo encerra com código 1 e uma mensagem que diz o que fazer |
| 3.2 | Nenhum tamanho mínimo de segredo | mínimo de 32 bytes (tamanho do bloco do HMAC-SHA256) |
| 3.3 | `jwt.verify` sem `algorithms` | fixado em `["HS256"]`, tanto ao assinar quanto ao validar |

O teste `token com alg "none" é recusado (confusão de algoritmo)` monta à mão
um token sem assinatura — o tipo de token que pode passar quando o `verify`
não fixa o algoritmo.

---

## 4. Segurança adicional

- **`helmet`** com uma Content-Security-Policy escrita à mão. Duas diretivas
  fazem diferença aqui: `script-src 'self'` e `script-src-attr 'none'`, que
  recusam qualquer script inline. Foi por isso que o CSS e o JS saíram de
  dentro do `index.html` e os `onclick` viraram `addEventListener`.
- **Rate limit em `/auth`**: 20 requisições por IP a cada 15 minutos (padrão,
  configurável). Sem ele, uma senha fraca é só questão de tempo.
- **Resposta única para credencial inválida**: e-mail inexistente e senha
  errada devolvem exatamente a mesma resposta, e o login faz uma comparação
  bcrypt mesmo quando o usuário não existe, para que o tempo de resposta não
  entregue quais e-mails estão cadastrados.

---

## 5. Domínio: posse dos restaurantes

Na V1, `POST /restaurants` gravava o restaurante sem registrar quem o criou —
não havia como saber de quem era. Agora:

- `Restaurant.userId` guarda o dono (migration
  `20260920190000_vincular_restaurante_ao_usuario`);
- `PUT` e `DELETE` exigem token **e** ser o dono (403 caso contrário);
- restaurantes sem dono (os do seed e os criados antes do vínculo) não podem
  ser alterados nem excluídos pela API — a coluna é opcional justamente para
  que a migration não quebre em um banco que já tem dados.
- `PUT` com `rating` omitido **mantém a nota atual**, em vez de zerá-la: o
  validador (`validateRestaurant(..., { isUpdate: true })`) remove o campo do
  resultado quando a nota não vem, e o Prisma ignora campos `undefined` no
  `update`. `rating: 0` continua sendo aceito — 0 é uma nota, não ausência de
  nota.

---

## 6. Testes

Suíte com `node --test` (embutido no Node 20+), **sem nenhuma dependência
nova** e **sem banco de dados**.

A técnica: o helper [`tests/helpers/prisma-stub.js`](../tests/helpers/prisma-stub.js)
coloca um dublê em memória no `require.cache` do Node, na entrada correspondente
a `src/database/prisma.js`, **antes** do primeiro `require`. Como o Node devolve
o que já está no cache, o arquivo original nunca é executado e nenhum
`PrismaClient` é instanciado. Tudo o que está acima dele — Express, rotas,
middlewares, validação, bcrypt e JWT — roda de verdade.

O dublê imita o comportamento do Prisma nos pontos que importam: `Decimal`
volta como string com uma casa decimal, violação de índice único lança `P2002`
e operação em registro inexistente lança `P2025`.

**Sobre o nome do arquivo:** o servidor de teste vive em
`tests/helpers/server.js`, não em `helpers/test-server.js`. O `node --test`
trata qualquer arquivo `test-*.js` (ou `*.test.js`) como um arquivo de teste e
o executa — o helper era contado como um "teste" a mais (e passava, por não
ter nenhum `test()` dentro). Com o nome atual isso não acontece mais; a suíte
tem exatamente 93 casos, todos com asserção.

No CI, essa suíte roda sem banco no job `build`, contra qualquer versão do
Node suportada. O job `banco` (ver seção 11) cobre o que ela não cobre:
migrations e comportamento com PostgreSQL de verdade.

---

## 7. Consistência entre schema e migrations

A migration do vínculo restaurante → usuário foi escrita à mão, porque o
ambiente da manutenção não tinha um PostgreSQL disponível para rodar
`prisma migrate dev`. SQL escrito à mão é exatamente onde nasce a divergência
silenciosa entre o que o `schema.prisma` declara e o que o banco tem.

Por isso existe [`tests/schema.test.js`](../tests/schema.test.js): ele lê os dois
arquivos, monta o "banco" que as migrations produzem e compara com o schema —
tabelas, colunas, tipos, nulidade, índices únicos, `@@index` e chaves
estrangeiras (inclusive o `ON DELETE`).

O teste foi verificado de forma negativa: trocando `userId INTEGER` por
`userId INTEGER NOT NULL` na migration, dois testes falham. Ele não é
decorativo.

Ele **não** substitui a verificação contra um banco real. Quem tiver Docker
pode rodar `npm run prisma:check` (ver README), que usa o próprio Prisma para
comparar migrations e schema.

---

## 8. `npm audit`

`npm audit fix` foi aplicado. O efeito foi conferido comparando o
`package-lock.json` antes e depois, pacote por pacote: **a única alteração foi
`qs` 6.15.3 → 6.16.0**.

Continuam 3 vulnerabilidades **altas**, todas na mesma cadeia:
`prisma` → `@prisma/config` → `deepmerge-ts` (aviso
[GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)).

Três observações honestas sobre elas:

1. **Não há correção não-breaking.** `npm audit fix --force` rebaixa o pacote
   `prisma` para a versão 6.12.0, o que é uma mudança quebrante.
2. **Não adianta instalar só as dependências de produção.** O `prisma` está em
   `devDependencies`, mas o `@prisma/client` o declara como *peerDependency
   opcional* — e o npm instala peers opcionais por padrão. Verificado na
   prática: `npm ci --omit=dev` continua trazendo `prisma` e `deepmerge-ts`
   para dentro de `node_modules`.
3. **O projeto não deve ser apresentado como "sem vulnerabilidades".** O CI
   roda `npm audit` como passo informativo (`continue-on-error: true`) para que
   o relatório fique visível em cada execução, sem esconder nem bloquear.

Atualizar a linha do Prisma resolveria, mas envolve avaliar a versão 7 — o que
é uma decisão arquitetural e pediria um ADR novo, fora do escopo desta
manutenção.

---

## 9. Front-end

- CSS e JS saíram do `index.html` para [`public/css/styles.css`](../public/css/styles.css)
  e [`public/js/app.js`](../public/js/app.js).
- O token passou de `localStorage` para **`sessionStorage`**: ele deixa de
  sobreviver ao fechamento do navegador, o que reduz a janela de uso em um
  dispositivo compartilhado.
- Todas as chamadas passam por uma função só (`apiFetch`), que trata **401** de
  forma consistente: encerra a sessão, avisa e leva a pessoa para a tela de
  login. Antes, isso existia apenas no formulário de cadastro de restaurante.
- Nenhum `onclick` no HTML — requisito da CSP e, de quebra, separação melhor
  entre estrutura e comportamento.

---

## 10. Compatibilidade com Windows

O script `prisma:check` (seção 7) originalmente lia o banco sombra assim,
direto no `package.json`:

```json
"prisma:check": "prisma migrate diff ... --shadow-database-url \"$SHADOW_DATABASE_URL\" ..."
```

`"$SHADOW_DATABASE_URL"` é sintaxe de substituição de variável do **Bash**. O
`npm`, no Windows, roda scripts pelo `cmd.exe` por padrão — que usa
`%VARIAVEL%` — então o Bash nunca chegava a interpretar nada: o Prisma recebia
a string literal `$SHADOW_DATABASE_URL` como se fosse a URL do banco, e o
comando falhava sempre, em qualquer máquina Windows.

Corrigido movendo a leitura da variável para JavaScript, onde
`process.env.SHADOW_DATABASE_URL` funciona igual em qualquer sistema:
[`scripts/prisma-check.js`](../scripts/prisma-check.js). O `package.json`
passou a chamar `node scripts/prisma-check.js`, sem nenhuma sintaxe de shell.
Verificado nos dois cenários: sem a variável definida (mensagem clara, código
de saída 1) e com a variável definida mas apontando para um banco inexistente
(erro do Prisma repassado, sem o script travar ou mascarar o código de saída).

O restante do projeto já era neutro em relação a sistema operacional — Node,
Express e Prisma rodam de forma idêntica em qualquer um. Esta era a única
linha do repositório com sintaxe de um shell específico.

---

## 11. Atrás de um proxy (`TRUST_PROXY`) e CORS (`CORS_ORIGIN`)

Dois problemas que só aparecem em produção, não em `npm start` local:

**`TRUST_PROXY`.** O Express só confia no cabeçalho `X-Forwarded-For` quando
configurado para isso (`app.set("trust proxy", ...)`). Sem essa configuração
atrás de um proxy reverso (Render, Railway, Fly, um Nginx na frente), o
`express-rate-limit` enxerga o IP do proxy, não o do cliente — e todos os
usuários passam a compartilhar um único contador de tentativas em `/auth`.
Verificado com dois usuários simulados atrás de um proxy: sem `TRUST_PROXY`,
o quarto login de qualquer um dos dois já vem bloqueado; com
`TRUST_PROXY=1`, cada IP tem o seu próprio contador
(`tests/rate-limit.test.js`). `TRUST_PROXY=true` é recusado de propósito: com
ele, o próprio cliente poderia escrever qualquer IP no
`X-Forwarded-For` e escapar do limite.

**`CORS_ORIGIN`.** O padrão anterior (`cors()`, sem argumento) libera
qualquer origem, sempre — inclusive em produção. Agora, fora de produção o
padrão continua liberando tudo (conveniente em desenvolvimento); em produção,
sem `CORS_ORIGIN` explícito, nenhum cabeçalho CORS é enviado — o que é seguro
por padrão, já que a interface é servida pela própria API. Publicando a
interface em outro domínio, basta informar essa variável
(`tests/cors.test.js`, `tests/env.test.js`).

Os dois são lidos e validados em [`src/config/env.js`](../src/config/env.js)
e aplicados em [`src/app.js`](../src/app.js).

---

## 12. Usuário de demonstração do seed agora é opt-in

O seed criava um usuário com senha fixa e pública sempre que `NODE_ENV` não
fosse `production` — inclusive em um banco de deploy configurado sem essa
variável. Agora ele só é criado com `SEED_DEMO_USER=true` no ambiente (e
continua nunca sendo criado com `NODE_ENV=production`, mesmo que
`SEED_DEMO_USER` esteja ligado). Ver
[`prisma/seed.js`](../prisma/seed.js) e o `.env.example`.

---

## 13. Front-end × Content-Security-Policy

A CSP declarada em `src/app.js` (seção 4) inclui `style-src 'self'`, que
recusa qualquer atributo `style="..."` escrito no HTML ou gerado por JS — o
navegador simplesmente ignora esses estilos, sem erro visível na tela, só um
aviso no console. Dois pontos da interface ainda geravam `style` inline:

- a animação escalonada de entrada dos cards de restaurante
  (`style="animation-delay: ..."`, calculada por item);
- a cor da mensagem de erro de carregamento.

Corrigido movendo os dois casos para fora do HTML gerado: o atraso da
animação é aplicado via CSSOM (`elemento.style.animationDelay`, que a CSP não
bloqueia — ela só recusa o atributo `style` **no marcado**, não a propriedade
manipulada por JavaScript) e a cor de erro virou a classe `.error-hint` em
`public/css/styles.css`. [`tests/frontend.test.js`](../tests/frontend.test.js)
verifica que `index.html` e `app.js` não voltam a gerar `style=` nem
`onclick=` inline, e que a CSP do servidor continua com `script-src 'self'`,
`script-src-attr 'none'` e `style-src 'self'`, sem `unsafe-inline`.

---

## 14. CI: um segundo job com PostgreSQL real

O job `build` roda a suíte de testes contra o dublê do Prisma — rápido, mas
não prova que as migrations aplicam num PostgreSQL de verdade, nem que o seed
é idempotente, nem que a API sobe e atende de ponta a ponta.

O job `banco` cobre isso: sobe um serviço PostgreSQL, aplica as migrations
(`prisma migrate deploy`), roda `prisma:check` (com um banco sombra criado no
próprio job), roda o seed duas vezes seguidas — a segunda não deve duplicar
nada — sobe a API com `node server.js` e roda
[`scripts/smoke-test.sh`](../scripts/smoke-test.sh) contra ela: cadastro,
login (inclusive senha errada e curta, que deve continuar dando 401), posse
de restaurante (outro usuário recebe 403), `PUT` sem `rating` mantendo a nota
e exclusão. Esse script também pode ser rodado localmente (ver README).

---

## 15. JWT em cookie httpOnly + CSRF

| # | Problema | Correção | Onde | Teste |
|---|----------|----------|------|-------|
| 15.1 | Token em `sessionStorage`: legível por qualquer script da página, inclusive um injetado por um XSS futuro | Cookie **httpOnly** (`easyfood_token`) — o navegador envia sozinho, nenhum script consegue lê-lo | [`src/shared/cookies.js`](../src/shared/cookies.js), [`auth.controller.js`](../src/modules/auth/auth.controller.js) | `login grava easyfood_token (httpOnly) e easyfood_csrf (legível)` |
| 15.2 | Cookie por si só reabre a porta do CSRF (o navegador o envia "de graça" em requisições que a pessoa não iniciou) | Defesa "double submit cookie": um segundo cookie legível (`easyfood_csrf`) precisa ser repetido no header `X-CSRF-Token` em toda chamada que muda estado | [`csrf.middleware.js`](../src/modules/auth/csrf.middleware.js) | `POST /restaurants via cookie SEM X-CSRF-Token é recusado (403)` / `...COM X-CSRF-Token correto funciona` |
| 15.3 | Clientes de API (Postman, curl, scripts) não devem ser afetados pela mudança | `authenticate` aceita header **ou** cookie; CSRF só é exigido quando a autenticação veio do cookie (`req.authSource`) | [`auth.middleware.js`](../src/modules/auth/auth.middleware.js) | `Authorization: Bearer continua funcionando sem X-CSRF-Token` |
| 15.4 | Um cookie httpOnly não pode ser apagado pelo próprio front-end (ao contrário do `sessionStorage`) | Novo `POST /auth/logout`, idempotente, apaga os dois cookies | [`auth.routes.js`](../src/modules/auth/auth.routes.js) | `POST /auth/logout apaga os dois cookies` |

Decisão completa, alternativas consideradas e consequências (inclusive as
negativas — como o `GET /auth/me` extra ao carregar a página) em
[ADR-006](adr/ADR-006-jwt-em-cookie-httponly.md).

---

## 16. Documentação OpenAPI (Swagger)

| # | Problema | Correção | Onde | Teste |
|---|----------|----------|------|-------|
| 16.1 | Nenhuma forma de explorar a API sem ler o código-fonte das rotas | Especificação OpenAPI 3 gerada a partir de comentários `@openapi` em cada rota, servida em `/docs` (Swagger UI) e `/docs.json` | [`src/config/swagger.js`](../src/config/swagger.js) | `GET /docs.json devolve uma especificação OpenAPI 3 com as rotas principais` |
| 16.2 | `swagger-ui-express` serve script/style inline, que a CSP estrita da API (`script-src 'self'`) bloquearia | `/docs` montado **antes** do `helmet()` em `app.js`, de propósito — só essa rota fica fora da CSP, o resto da API continua protegido | [`src/app.js`](../src/app.js) | `GET /docs responde com a página do Swagger UI` |
| 16.3 | Documentação pode não ser desejável em todo ambiente (ex.: produção) | Liga/desliga por `API_DOCS_ENABLED` (padrão: ligado) | [`src/config/env.js`](../src/config/env.js) | `API_DOCS_ENABLED=false desliga /docs e /docs.json (404)` |

---

## 17. Escaneamento de segredos no CI

| # | Problema | Correção | Onde | Teste |
|---|----------|----------|------|-------|
| 17.1 | Nada impedia, na prática, que uma chave ou senha real fosse commitada por engano num push futuro | Novo job `seguranca`, independente do `build`, escaneia todo o histórico com [gitleaks](https://github.com/gitleaks/gitleaks) a cada push/PR | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | validado manualmente (gitleaks roda dentro do Actions, não há como reproduzir num teste `node --test`) |
| 17.2 | Os únicos "segredos" reais do repositório são fixtures conhecidas (o `JWT_SECRET` de 64 caracteres hex usado só pelos testes, e a senha pública e opt-in do seed de demonstração) — sem tratamento, dariam falso positivo e quebrariam o CI | `.gitleaks.toml` documenta e permite (allowlist) só esses dois casos, com o porquê de cada um | [`.gitleaks.toml`](../.gitleaks.toml) | — |

A auditoria manual do histórico completo (`git log -p --all`, à procura de
`JWT_SECRET=`, `DATABASE_URL=` e padrões semelhantes) já tinha confirmado que
nenhum segredo real está commitado neste projeto. O job `seguranca` automatiza
essa mesma checagem a cada push, para que ela não dependa de alguém lembrar
de repeti-la manualmente.

---

## 18. Front-end: busca, ordenação e nova identidade visual

| # | Problema | Correção | Onde | Teste |
|---|----------|----------|------|-------|
| 18.1 | Campo de busca existia no HTML, mas com o atributo `disabled` — nunca funcionou | Busca por nome, client-side, combinada com o filtro de categoria já existente | [`public/js/app.js`](../public/js/app.js) | manual (front-end não tem teste automatizado de interação; `frontend.test.js` cobre CSP e presença de classes) |
| 18.2 | "Ordenar ▾" era um `<span>` decorativo, sem nenhuma função | `<select>` funcional: nome (A–Z/Z–A) e avaliação (maior/menor) | [`public/index.html`](../public/index.html), [`public/js/app.js`](../public/js/app.js) | manual |
| 18.3 | Cards mostravam preço e tempo de entrega **inventados** (`Math.random()`), sem nenhum campo correspondente na API — dado falso apresentado como real | Removidos; no lugar, um selo de avaliação (dado real, vindo de `rating`) sobre o ícone da categoria | [`public/js/app.js`](../public/js/app.js) | — |
| 18.4 | Ícone de carrinho fixo (com contador "2" fixo) sem nenhuma funcionalidade de carrinho no projeto | Removido | [`public/index.html`](../public/index.html) | — |
| 18.5 | Paleta genérica, sem identidade própria | Paleta autoral em tom "molho de tomate assado", inspirada no gênero dos apps de delivery — sem reutilizar cor, tipografia ou qualquer ativo de marca de um app existente | [`public/css/styles.css`](../public/css/styles.css) | — |

A captura de tela em `docs/img/interface.png` ainda é da versão anterior —
ver "Próximos passos" no README.



## Histórico do Git

O repositório entregue **não tenta reconstruir os seis sprints com commits
retroativos**. Inventar datas e autoria para simular um desenvolvimento que não
aconteceu daquela forma seria falsear a evidência mais objetiva que um
repositório oferece.

O que existe, em ordem:

- **`v1.0.0`** — o primeiro commit, com o projeto exatamente como foi entregue
  na Aula 6. É a "V1" pedida.
- **`v1.1.0`** — a primeira rodada de manutenção: robustez da API, validação,
  JWT, segurança, posse de restaurantes, front-end, testes automatizados, CI e
  `npm audit` (seções 1 a 9 e 8 acima).
- **`v1.1.1`** — correção do `prisma:check` no Windows (seção 10).
- **`v1.2.0`** — esta rodada: login não vaza a política de senha, `PUT`
  preserva a nota quando ela não vem, `TRUST_PROXY` e `CORS_ORIGIN`,
  usuário de demonstração do seed como opt-in, o conflito entre o front-end e
  a CSP, e um segundo job de CI com PostgreSQL de verdade (seções 11 a 14).
- **(ainda não commitada)** — cookie httpOnly + CSRF no lugar de
  `sessionStorage`, documentação OpenAPI em `/docs`, escaneamento de
  segredos no CI e o polish de UX do front-end (seções 15 a 18). Sugestão de
  tag ao commitar: `v1.3.0`.

Cada tag corresponde a um estado do código que de fato existiu, e o README
aponta para a mais recente.

---

## O que foi deliberadamente deixado de fora

| Item | Motivo |
|------|--------|
| Prisma 7 | mudança de versão maior; pede avaliação e ADR próprio |
| MySQL / SQLite | a [ADR-002](adr/ADR-002-persistencia-com-postgresql.md) já decidiu PostgreSQL |
| Camada `repository` | a [ADR-003](adr/ADR-003-arquitetura-em-camadas.md) definiu quatro camadas; acrescentar uma quinta é evolução de arquitetura e exigiria um ADR novo |
| Arquitetura orientada a eventos | a [ADR-005](adr/ADR-005-comunicacao-direta-sem-eventos.md) decidiu manter comunicação direta; o cenário foi implementado como ela manda |
| Envio real de e-mail (SMTP) | credenciais e serviço externo fora do escopo; o cenário da ADR-005 é simulado com log |
