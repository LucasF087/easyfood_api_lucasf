# ADR-001 — Armazenar restaurantes em memória

| Campo          | Valor                                      |
|----------------|---------------------------------------------|
| **Status**     | Aceito (superado pela ADR-002)              |
| **Data**       | 2026-08-20                                   |
| **Responsável**| Felipe Padrinho — Arquiteto de Software, FECAF |

---

## Contexto

Primeira versão da API do EasyFood. Ela precisa devolver uma lista de restaurantes para consulta e permitir o cadastro de novos restaurantes.

O produto está em fase de prototipação, teste e validação, e a prioridade é validar o fluxo e fazer uma apresentação para investidores de forma rápida e simples.

---

## Alternativas consideradas

| # | Opção            |
|---|------------------|
| 1 | Array em memória |
| 2 | PostgreSQL       |
| 3 | MongoDB          |
| 4 | SQLite           |
| 5 | Firebase         |
| 6 | Arquivo JSON     |

---

## Decisão

Adotar um **array em memória** como mecanismo de armazenamento na versão inicial do serviço.

---

## Justificativa

- Permite praticidade e velocidade no desenvolvimento e nos testes da API
- Menor complexidade de implementação
- Zero custo de infraestrutura na fase de prototipação

---

## Consequências

### Positivas

- ✅ Desenvolvimento e testes rápidos
- ✅ Conseguimos comprovar o conceito de negócio (prova de conceito)

### Negativas

- ❌ Não conseguimos persistir dados entre reinicializações do servidor
- ❌ Não suporta compartilhamento de dados entre instâncias, nem análises sobre os dados
- ❌ O fluxo de respostas fica limitado — não há como modelar relacionamentos
- ❌ Sem integridade ou validação de dados no nível do armazenamento

---

## Critérios de revisão

Esta decisão deve ser reavaliada quando:

1. O MVP for validado e houver decisão de ir para produção
2. Houver necessidade de persistência entre deploys
3. O volume de dados ultrapassar o que é razoável manter em memória
4. For necessário suporte a consultas complexas ou relacionamentos entre entidades

---

## Notas

- A interface de acesso aos dados (`push`, `filter`, `find`) foi abstraída de forma que a migração futura para banco de dados exigisse alterações mínimas na camada de roteamento.
- Recomendou-se que o ADR de escolha do banco definitivo (ADR-002) fosse criado antes da entrada em produção — o que foi feito.

> **Atualização:** todos os critérios de revisão acima já se concretizaram. Esta decisão foi formalmente substituída pela [ADR-002](./ADR-002-persistencia-com-postgresql.md), que adota PostgreSQL via Prisma como mecanismo de persistência definitivo.
