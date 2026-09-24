# ADR-006 — JWT em cookie httpOnly (com defesa CSRF), em vez de sessionStorage

| Campo       | Valor                          |
|-------------|--------------------------------|
| **Status**  | Aceito                         |
| **Data**    | 2026-09-24                     |
| **Autores** | Equipe de Engenharia EasyFood  |

---

## Contexto

Desde a [ADR-004](./ADR-004-autenticacao-com-jwt.md), o front-end de `public/` guardava o JWT em `sessionStorage` e o enviava manualmente no header `Authorization: Bearer <token>`. Essa escolha já resolvia o problema original (não sobreviver ao fechamento da aba), mas tem uma fragilidade conhecida: qualquer script que rode na página — inclusive um injetado por uma falha de XSS que venha a existir no futuro — consegue ler `sessionStorage` e roubar o token. Um cookie **httpOnly** fecha essa porta: o navegador nunca expõe o valor a `document.cookie` nem a nenhuma API de JavaScript.

---

## Alternativas consideradas

| # | Opção | Descrição |
|---|-------|-----------|
| 1 | **Manter em sessionStorage** | Simples, já funcionando, mas legível por qualquer script da página (risco de XSS) |
| 2 | **Cookie httpOnly, sem defesa extra** | Fecha o roubo via XSS, mas abre a porta para CSRF: o navegador passa a enviar o cookie sozinho em qualquer requisição para a API, inclusive as que a pessoa não iniciou |
| 3 | **Cookie httpOnly + CSRF (double submit cookie)** | Fecha as duas portas, ao custo de mais uma etapa no front-end (ler um cookie e repetir o valor num header) |
| 4 | **Cookie httpOnly + sessão no servidor (Redis)** | Permitiria revogar sessões individualmente, mas reabre a discussão já resolvida na ADR-004: a API deixaria de ser stateless por um ganho que não é um requisito hoje |

---

## Decisão

Migrar o token do front-end de `sessionStorage` para um **cookie httpOnly**, e adotar o padrão **double submit cookie** como defesa contra CSRF: no login, além do cookie do JWT, a API grava um segundo cookie (legível por JavaScript) com um valor aleatório; o front-end o repete no header `X-CSRF-Token` em toda chamada `POST`/`PUT`/`DELETE`, e o servidor recusa a requisição se os dois não baterem (`src/modules/auth/csrf.middleware.js`).

Clientes que autenticam pelo header `Authorization: Bearer` (Postman, curl, apps mobile, scripts) continuam funcionando exatamente como antes — o cookie e o CSRF são específicos do front-end servido pela própria API, que é o único a depender de um cookie enviado automaticamente pelo navegador.

---

## Justificativa

- **Reduz o alcance de um XSS** — um script malicioso injetado na página não consegue mais ler o token; na pior hipótese, ele ainda pode *usar* o cookie enquanto a página estiver aberta, mas não pode *exfiltrá-lo* para outro domínio
- **CSRF é o preço específico de usar cookie, não uma regressão geral** — só existe porque o navegador envia cookies "de graça"; o double submit cookie neutraliza isso sem exigir armazenamento de sessão no servidor, mantendo a API stateless (mesmo raciocínio da ADR-004)
- **`sameSite: "lax"` já filtra a maior parte dos ataques mais simples** (POST disparado por `<form>` de outro site) antes mesmo do CSRF token entrar em ação — o double submit cookie cobre o restante (por exemplo, um `fetch` de outra aba do mesmo navegador)
- **Não quebra os clientes de API** — Postman, curl e scripts de teste seguem usando `Authorization: Bearer`, que nunca precisou (e continua não precisando) de proteção CSRF, porque não é enviado automaticamente pelo navegador

---

## Consequências

### Positivas

- ✅ O token JWT nunca fica acessível a `document.cookie` ou a qualquer script da página
- ✅ Continua sem sessão no servidor — a API permanece stateless
- ✅ Compatível com os clientes de API existentes, sem mudança de contrato para eles
- ✅ O cookie do token é um cookie de sessão do navegador (sem `maxAge`), preservando a mesma garantia que o `sessionStorage` já dava: não sobrevive ao fechamento da aba

### Negativas

- ❌ Mais uma etapa no front-end: ler o cookie CSRF e reenviá-lo manualmente a cada chamada que muda estado — código e conceito a mais em relação a só copiar o token do `sessionStorage`
- ❌ Um `GET /auth/me` extra é necessário ao carregar a página para saber se existe uma sessão válida (o front-end não guarda mais o usuário em lugar nenhum entre recarregamentos)
- ❌ Em desenvolvimento local (`http://localhost`), o cookie não pode usar `secure: true` (exigiria HTTPS) — fica ligado automaticamente só quando `NODE_ENV=production` (ver `COOKIE_SECURE` em `src/config/env.js`)

---

## Critérios de revisão

Esta decisão deve ser reavaliada quando:

1. O front-end deixar de ser servido pela mesma origem da API (por exemplo, um SPA hospedado em outro domínio) — nesse caso `sameSite: "lax"` pode não bastar e vale reconsiderar `sameSite: "none"` com HTTPS obrigatório
2. Surgir a necessidade de revogar sessões individualmente antes da expiração — reabre a alternativa 4 (sessão no servidor)

---

## Notas

- Nomes dos cookies e opções ficam centralizados em `src/shared/cookies.js`, para que `auth.controller.js`, `auth.middleware.js` e `csrf.middleware.js` nunca fiquem fora de sincronia.
- `POST /auth/login` continua devolvendo o token também no corpo da resposta — é o que os clientes de API (e os testes automatizados existentes) usam.
- `POST /auth/logout` foi adicionado só por causa do cookie: `sessionStorage` bastava apagar no próprio navegador; um cookie httpOnly só pode ser apagado por uma resposta do servidor.
