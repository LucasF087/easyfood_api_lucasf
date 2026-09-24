# ADR-003 — Reorganizar o monólito em arquitetura de camadas

| Campo       | Valor                          |
|-------------|--------------------------------|
| **Status**  | Aceito                         |
| **Data**    | 2026-09-19                     |
| **Autores** | Equipe de Engenharia EasyFood  |

---

## Contexto

Com o suporte a PostgreSQL via Prisma (ver [ADR-002](./ADR-002-persistencia-com-postgresql.md)), o `server.js` passou a concentrar várias responsabilidades ao mesmo tempo:

- Inicializar o Express
- Configurar middlewares
- Definir rotas
- Validar dados de entrada
- Acessar o Prisma e conversar com o banco
- Subir o servidor

Esse arranjo funciona enquanto a aplicação é pequena, mas conforme a EasyFood cresce (novos domínios como autenticação, pedidos, avaliações), um único arquivo concentrando tudo tende a ficar cada vez mais difícil de ler, testar e manter.

---

## Alternativas consideradas

| # | Opção | Descrição |
|---|-------|-----------|
| 1 | Manter tudo em `server.js` | Simples, mas escala mal conforme o domínio cresce |
| 2 | Monólito modular (camadas: Routes → Controller → Service → Database) | Mesmo processo/deploy, porém organizado por responsabilidades |
| 3 | Microsserviços (um serviço por domínio) | Escalabilidade e deploy independentes, porém alto custo operacional para o estágio atual do produto |

---

## Decisão

Adotar um **monólito modular organizado em camadas**: `server.js → app.js → routes → controller → service → database → PostgreSQL`, mantendo um único processo e um único deploy, mas separando claramente as responsabilidades dentro do código.

A EasyFood **permanece monolítica** neste momento — a decomposição em microsserviços não se justifica ainda pelo volume de tráfego, tamanho de time ou necessidade de escalar partes do sistema de forma independente.

---

## Justificativa

- **`server.js`** passa a ter uma única responsabilidade: ligar o servidor
- **`app.js`** concentra a configuração da aplicação (middlewares, arquivos estáticos, registro de rotas)
- **Routes** apenas definem caminhos e apontam para o Controller correto — não acessam o Prisma diretamente
- **Controller** recebe `req`/`res`, valida a entrada e devolve a resposta — não conhece regras de negócio nem SQL
- **Service** concentra as regras e operações do domínio e não depende de `req`/`res`, o que facilita reaproveitá-lo (ex: em um script de seed ou em uma futura fila de processamento)
- **Database** isola a única instância do `PrismaClient`, evitando múltiplas conexões espalhadas pelo código
- Cada camada pode ser testada isoladamente, e um novo domínio (como `auth/`) pode ser adicionado em `src/modules/` sem tocar no que já existe
- O comportamento externo da API não muda — é uma refatoração, não uma reescrita

---

## Consequências

### Positivas

- ✅ Responsabilidades claras e isoladas, mais fáceis de localizar e alterar
- ✅ Novo domínio (`auth/`) adicionado em `src/modules/auth/` seguindo o mesmo padrão dos restaurantes, sem afetar o módulo existente
- ✅ Service livre de HTTP, podendo ser reaproveitado por outras entradas (scripts, filas, testes)
- ✅ Caminho natural para, no futuro, extrair um módulo para um serviço separado caso a necessidade real apareça

### Negativas

- ❌ Mais arquivos e mais indireção do que um único `server.js` — exige entender o fluxo entre as camadas
- ❌ Para um protótipo muito pequeno, a estrutura pode parecer "excesso de engenharia"
- ❌ Continua sendo um monólito: não resolve, por si só, necessidades futuras de escala independente por domínio

---

## Critérios de revisão

Esta decisão deve ser reavaliada quando:

1. Um módulo específico (ex: pedidos) precisar escalar de forma independente dos demais
2. Times diferentes precisarem fazer deploy de partes distintas do sistema sem depender uns dos outros
3. A comunicação síncrona dentro do mesmo processo deixar de ser suficiente e for necessário mensageria assíncrona entre domínios

---

## Notas

- A estrutura de pastas segue `src/database/`, `src/modules/<dominio>/{service,controller,routes}.js` e `src/app.js`, permitindo que cada novo domínio seja adicionado como uma pasta irmã em `src/modules/`.
- O módulo `auth/` foi criado seguindo exatamente esse padrão — ver [ADR-004](./ADR-004-autenticacao-com-jwt.md) para a decisão de autenticação.
