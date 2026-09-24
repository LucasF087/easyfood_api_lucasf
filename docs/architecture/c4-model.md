# Arquitetura da EasyFood — Modelo C4

Este documento descreve a arquitetura da EasyFood nos três primeiros níveis do [modelo C4](https://c4model.com/), do mais geral ao mais detalhado. O quarto nível (Code) é o próprio código-fonte em [`src/`](../../src/).

Os diagramas usam [Mermaid](https://mermaid.js.org/), que o GitHub renderiza automaticamente.

As decisões por trás desta arquitetura estão registradas nos [ADRs](../adr/):

- [ADR-002](../adr/ADR-002-persistencia-com-postgresql.md) — PostgreSQL como banco de dados
- [ADR-003](../adr/ADR-003-arquitetura-em-camadas.md) — monólito modular em camadas
- [ADR-004](../adr/ADR-004-autenticacao-com-jwt.md) — autenticação com JWT
- [ADR-005](../adr/ADR-005-comunicacao-direta-sem-eventos.md) — comunicação direta entre módulos, sem eventos por ora

---

## Nível 1 — Contexto

**Quem usa o sistema e com o que ele se relaciona?**

A EasyFood é usada por pessoas que consultam restaurantes e por restaurantes (usuários autenticados) que se cadastram. Nesta versão não há integração com sistemas externos.

```mermaid
flowchart TB
    usuario["👤 Usuário<br/>Consulta os restaurantes disponíveis"]
    restaurante["👤 Restaurante<br/>Cria conta, faz login e cadastra restaurantes"]
    easyfood["EasyFood<br/>Consulta e cadastro de restaurantes,<br/>com login de usuários"]

    usuario -->|"Consulta restaurantes"| easyfood
    restaurante -->|"Autentica-se e cadastra restaurantes"| easyfood

    classDef person fill:#08427b,stroke:#052e56,color:#ffffff
    classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff
    class usuario,restaurante person
    class easyfood system
```

---

## Nível 2 — Contêineres

**Quais aplicações e armazenamentos formam o sistema?**

A interface web é servida pelo próprio Express (`express.static`), então interface e API compartilham a mesma origem e o mesmo deploy. Em desenvolvimento, o PostgreSQL roda via [`docker-compose.yml`](../../docker-compose.yml).

```mermaid
flowchart TB
    usuario["👤 Usuário<br/>Usa o sistema pelo navegador"]

    subgraph easyfood["Sistema EasyFood"]
        direction TB
        web["Interface web<br/>[HTML, CSS e JavaScript — public/index.html]<br/>Lista e filtra restaurantes, login, criação de conta e cadastro"]
        api["API EasyFood<br/>[Node.js + Express 5]<br/>Autenticação JWT e regras de restaurantes; serve a interface"]
        db[("PostgreSQL<br/>[banco relacional]<br/>Tabelas Restaurant e User")]
    end

    usuario -->|"Acessa"| web
    web -->|"HTTP/JSON<br/>/restaurants e /auth/*"| api
    api -->|"Prisma ORM<br/>SQL sobre TCP"| db
    api -.->|"Entrega os arquivos estáticos"| web

    classDef person fill:#08427b,stroke:#052e56,color:#ffffff
    classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff
    class usuario person
    class web,api,db container
```

---

## Nível 3 — Componentes (API EasyFood)

**Como a API está organizada internamente?**

A API segue o fluxo `routes → controller → service → database` (ADR-003). O middleware de autenticação é reaproveitado por qualquer módulo que precise proteger rotas (ADR-004).

Os componentes transversais — configuração, middlewares e tratamento de erro — foram acrescentados na manutenção de setembro/2026 (ver [`docs/manutencao.md`](../manutencao.md)). Eles não alteram o fluxo das camadas: apenas cercam a aplicação de forma que nenhuma requisição chegue ao controller sem passar pela validação de ambiente, de formato e de tamanho, e que nenhuma resposta de erro saia fora do formato JSON.

```mermaid
flowchart TB
    web["Interface web<br/>[navegador]"]
    db[("PostgreSQL")]

    subgraph api["API EasyFood [Node.js + Express]"]
        direction TB
        server["server.js<br/>Valida o ambiente, liga o servidor e faz o encerramento ordenado"]
        config["config/env.js<br/>Carrega e valida as variáveis de ambiente (falha rápido sem JWT_SECRET)"]
        app["app.js<br/>helmet, CORS, JSON com limite, arquivos estáticos e montagem das rotas"]

        subgraph middlewares["Middlewares transversais"]
            reqMw["request.js<br/>Normaliza req.body e exige Content-Type JSON"]
            rateMw["rate-limit.js<br/>Limita tentativas em /auth"]
            errMw["error-handler.js<br/>404 e erros sempre em JSON; stack só no log"]
        end

        subgraph auth["Módulo auth"]
            authRoutes["auth.routes.js<br/>POST /auth/register, POST /auth/login, GET /auth/me"]
            authCtrl["auth.controller.js<br/>Valida a entrada e responde HTTP"]
            authSvc["auth.service.js<br/>Hash de senha com bcrypt e emissão do JWT"]
            authMw["auth.middleware.js<br/>Valida o Bearer token e popula req.user"]
        end

        subgraph restaurants["Módulo restaurants"]
            restRoutes["restaurant.routes.js<br/>GET público; POST, PUT e DELETE protegidos"]
            restCtrl["restaurant.controller.js<br/>Valida a entrada e responde HTTP"]
            restSvc["restaurant.service.js<br/>Operações e regra de posse (só o dono altera ou exclui)"]
        end

        subgraph notif["Módulo notifications"]
            notifSvc["notification.service.js<br/>Cenário da ADR-005 simulado com log (e-mail, atividade, comercial)"]
        end

        health["health.routes.js<br/>GET /health (liveness, não toca no banco)"]
        prisma["database/prisma.js<br/>Instância única do PrismaClient"]
    end

    web -->|"HTTP/JSON"| app
    server --> config
    server --> app
    app --> config
    app --> reqMw
    app --> health
    app --> authRoutes
    app --> restRoutes
    app --> errMw
    authRoutes --> rateMw

    authRoutes -->|"POST"| authCtrl
    authCtrl --> authSvc
    authSvc --> prisma
    authRoutes -->|"GET /me"| authMw

    restRoutes -->|"GET"| restCtrl
    restRoutes -->|"POST"| authMw
    authMw -->|"token válido"| restCtrl
    restCtrl --> restSvc
    restSvc --> prisma
    restSvc -->|"chamada direta (ADR-005)"| notifSvc

    prisma -->|"SQL"| db

    classDef component fill:#85bbf0,stroke:#5d82a8,color:#000000
    classDef external fill:#438dd5,stroke:#2e6295,color:#ffffff
    class server,config,app,reqMw,rateMw,errMw,health,authRoutes,authCtrl,authSvc,authMw,restRoutes,restCtrl,restSvc,notifSvc,prisma component
    class web,db external
```

---

## Nível 4 — Código

O nível 4 é o próprio código em [`src/`](../../src/). Para complementar, o diagrama abaixo mostra o caminho de uma requisição protegida: o cadastro de um restaurante.

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário (navegador)
    participant R as restaurant.routes
    participant M as auth.middleware
    participant C as restaurant.controller
    participant V as validators
    participant S as restaurant.service
    participant P as Prisma
    participant DB as PostgreSQL
    participant N as notification.service

    U->>R: POST /restaurants com Authorization: Bearer TOKEN
    R->>M: authenticate
    alt token ausente, inválido ou expirado
        M-->>U: 401 Unauthorized
    else token válido
        M->>C: next() com req.user preenchido
        C->>V: validateRestaurant(name, category, rating)
        alt dados inválidos
            V-->>C: lista de erros
            C-->>U: 400 Bad Request
        else dados válidos
            V-->>C: dados normalizados (rating vira 0 se ausente)
            C->>S: createRestaurant(dados, req.user)
            S->>P: restaurant.create({ ...dados, userId: req.user.id })
            P->>DB: INSERT
            DB-->>P: registro criado
            P-->>S: restaurante (com o dono)
            S-)N: notificar(restaurante) — chamada direta, sem esperar (ADR-005)
            S-->>C: restaurante
            C-->>U: 201 Created
        end
    end

    Note over N: registra em log: e-mail simulado,<br/>atividade e aviso ao comercial
```

---

## Manutenção

Atualize estes diagramas quando uma decisão arquitetural mudar a estrutura do sistema (novo módulo, novo contêiner, novo serviço externo) e registre a decisão em um novo ADR.
