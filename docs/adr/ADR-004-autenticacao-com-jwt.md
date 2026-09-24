# ADR-004 — Autenticação com JWT

| Campo       | Valor                          |
|-------------|--------------------------------|
| **Status**  | Aceito                         |
| **Data**    | 2026-09-19                     |
| **Autores** | Equipe de Engenharia EasyFood  |

---

## Contexto

Com a EasyFood organizada em camadas (ver [ADR-003](./ADR-003-arquitetura-em-camadas.md)), o próximo passo do domínio é permitir que pessoas se cadastrem, façam login e tenham o cadastro de restaurantes restrito a usuários autenticados. É preciso escolher um mecanismo de autenticação adequado ao estágio atual do produto: uma API stateless, ainda em fase de validação, com um único serviço e sem integração prévia com provedores externos.

---

## Alternativas consideradas

| # | Opção | Descrição |
|---|-------|-----------|
| 1 | **JWT (JSON Web Token)** | Token assinado, autocontido, verificado sem consultar o banco a cada requisição |
| 2 | **Sessão + cookie no servidor** | Requer armazenamento de sessão (ex: Redis) e afinidade de sessão entre instâncias |
| 3 | **AWS Cognito** | Serviço gerenciado de identidade; resolve MFA, recuperação de senha, escala, mas adiciona dependência de infraestrutura externa e curva de configuração |
| 4 | **Login social (Google OAuth)** | Bom para reduzir atrito de cadastro, mas exige que o usuário já tenha conta Google e adiciona complexidade de integração OAuth |

---

## Decisão

Adotar **JWT** como mecanismo de autenticação da EasyFood, com senhas protegidas por hash (`bcryptjs`) e tokens assinados com uma chave secreta (`jsonwebtoken`), lidos de uma variável de ambiente (`JWT_SECRET`).

---

## Justificativa

- **Stateless por natureza** — o servidor não precisa guardar sessão em memória nem em um armazenamento externo (Redis, banco); o próprio token carrega a identidade do usuário, o que combina bem com uma API simples e com poucas instâncias
- **Simplicidade de implementação** — apenas duas bibliotecas (`jsonwebtoken` e `bcryptjs`), sem infraestrutura adicional, alinhado ao estágio atual de prototipação/validação do produto
- **Zero custo e sem dependência de terceiros** — ao contrário do AWS Cognito ou de um provedor OAuth, não exige conta em serviço externo nem cobrança por usuário ativo
- **Sem exigir conta em outro provedor** — diferente do login social, qualquer pessoa pode se cadastrar diretamente com e-mail e senha, sem depender de ter uma conta Google
- **Padrão amplamente adotado** — grande suporte no ecossistema Node.js/Express e curva de aprendizado baixa para o time
- **Suficiente para o problema atual** — a necessidade agora é apenas identificar quem está autenticado para proteger o cadastro de restaurantes; não há, ainda, requisito de MFA, SSO corporativo ou login social

---

## Consequências

### Positivas

- ✅ Nenhuma infraestrutura extra de sessão — o token é validado localmente a cada requisição
- ✅ Senhas nunca armazenadas em texto puro (hash via `bcryptjs`)
- ✅ Rotas protegidas de forma simples, via middleware (`auth.middleware.js`) reaproveitável por qualquer módulo
- ✅ Fácil evoluir para novos domínios protegidos (ex: pedidos) reaproveitando o mesmo middleware

### Negativas

- ❌ Revogar um token antes do seu vencimento não é trivial (não há uma "lista negra" implementada) — se uma conta for comprometida, o token válido continua funcionando até expirar
- ❌ O segredo (`JWT_SECRET`) é um ponto único de confiança — se vazar, qualquer token pode ser forjado
- ❌ Não resolve, por si só, funcionalidades como MFA, recuperação de senha ou login social — caso vire requisito, precisará de solução complementar
- ❌ Tokens carregam dados (ainda que mínimos) que trafegam a cada requisição

---

## Critérios de revisão

Esta decisão deve ser reavaliada quando:

1. For necessário revogar sessões individualmente antes da expiração (ex: "sair de todos os dispositivos")
2. Surgir requisito de login social, SSO corporativo ou múltiplos fatores de autenticação
3. O produto crescer a ponto de justificar um serviço de identidade dedicado (ex: AWS Cognito, Auth0, Keycloak)

---

## Notas

- O token é assinado com `expiresIn: "1d"` — expira em 1 dia, exigindo novo login após esse período.
- O `JWT_SECRET` fica exclusivamente em variável de ambiente (`.env`), nunca no código-fonte — ver `.env.example`.
- Endpoints implementados: `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (protegido) e `POST /restaurants` (agora também protegido pelo mesmo middleware).
