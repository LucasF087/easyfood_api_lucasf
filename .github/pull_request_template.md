## O que mudou?

<!-- Descreva a mudança em poucas linhas. -->

## Por quê?

<!-- Qual problema resolve ou qual requisito atende? -->

## Como testar

<!-- Passo a passo ou requisições. Ex.: POST /restaurants sem token → 401. -->

## Checklist

- [ ] A API sobe (`npm start`) e as rotas afetadas foram testadas
- [ ] `npm test` passa localmente (e o CI está verde)
- [ ] Nenhum segredo foi commitado (o `.env` fica fora do Git; só o `.env.example` é versionado)
- [ ] Se a mudança afeta deploy, `TRUST_PROXY` e `CORS_ORIGIN` (em `.env.example`) continuam corretos
- [ ] O código respeita as camadas: routes → controller → service → database
- [ ] Se houve decisão arquitetural, criei ou atualizei um ADR em `docs/adr/`
- [ ] README e docs atualizados, quando necessário
