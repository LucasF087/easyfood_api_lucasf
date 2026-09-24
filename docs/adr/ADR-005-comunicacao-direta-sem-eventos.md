# ADR-005 — Manter comunicação direta entre módulos (sem arquitetura orientada a eventos por ora)

| Campo       | Valor                          |
|-------------|--------------------------------|
| **Status**  | Aceito                         |
| **Data**    | 2026-09-20                     |
| **Autores** | Equipe de Engenharia EasyFood  |

---

## Contexto

A EasyFood é um monólito modular (ver [ADR-003](./ADR-003-arquitetura-em-camadas.md)) com os módulos `restaurants` e `auth`. Foi discutida uma nova necessidade: quando um restaurante for cadastrado, o sistema também deve:

- enviar um e-mail de boas-vindas;
- registrar a atividade;
- notificar o time comercial.

Hoje o `POST /restaurants` apenas salva o restaurante no banco. Fazer todas essas ações dentro do Restaurant Service funciona, mas o serviço passaria a conhecer cada reação ao cadastro. Se o sistema continuar crescendo (gerar cupom, atualizar CRM, enviar dados para analytics), essa lista só aumenta.

Havia duas formas de tratar o problema: o Restaurant Service chamar diretamente cada interessado, ou publicar um evento (`restaurant.created`) e deixar que os interessados decidam como reagir, por meio de uma fila ou broker de mensagens.

---

## Alternativas consideradas

| # | Opção | Descrição |
|---|-------|-----------|
| 1 | **Comunicação direta** | O serviço conhece e chama diretamente os outros componentes (e-mail, atividade, comercial). Fluxo explícito e sem infraestrutura nova. |
| 2 | **Arquitetura orientada a eventos** | O serviço publica um evento (`restaurant.created`) e consumidores independentes reagem a ele, por meio de fila ou broker (ex: RabbitMQ, Apache Kafka, AWS SQS/SNS, Google Pub/Sub, Azure Service Bus). |

---

## Decisão

**Não adotar arquitetura orientada a eventos neste momento.** A EasyFood mantém a comunicação direta entre componentes, dentro do monólito modular, sem broker ou fila de mensagens.

---

## Justificativa

- **Poucos componentes e fluxo simples** — as dependências entre os módulos são conhecidas e fáceis de acompanhar
- **Monólito modular** — todos os componentes rodam no mesmo processo e no mesmo deploy (ver ADR-003), então uma chamada direta é o caminho mais simples
- **Sem necessidade atual de broker ou fila** — não existe hoje um problema que só eventos resolvam; a tecnologia deve vir depois da necessidade
- **Eventos têm custo** — trazem infraestrutura adicional, mais complexidade de observabilidade, tratamento de falhas e consistência
- **Não adotar também é uma decisão arquitetural** — registrá-la deixa claro por que a alternativa foi descartada agora e quando reavaliar

---

## Consequências

### Positivas

- ✅ Fluxo explícito, fácil de ler e de depurar
- ✅ Nenhuma infraestrutura nova para operar, monitorar ou pagar (broker, filas)
- ✅ Menos formas de falhar: sem mensagens perdidas, duplicadas ou fora de ordem
- ✅ Coerente com a decisão de manter o monólito modular (ADR-003)

### Negativas

- ❌ Acoplamento: o Restaurant Service precisa conhecer cada componente que reage ao cadastro, e toda nova reação exige alterá-lo
- ❌ Comunicação síncrona: quem chama espera a resposta, então uma ação lenta ou com falha (ex: envio de e-mail) pode atrasar ou derrubar o cadastro
- ❌ Não há processamento independente nem reprocessamento de mensagens

---

## Critérios de revisão

Esta decisão deve ser reavaliada quando:

1. O cadastro de restaurante passar a disparar várias reações (e-mail, atividade, comercial, cupom, CRM, analytics) e o Restaurant Service ficar responsável por conhecer todas
2. Uma reação lenta ou instável começar a atrasar ou derrubar o `POST /restaurants` sem necessidade
3. Novos consumidores precisarem ser adicionados sem alterar o módulo que produz a informação
4. A decisão de manter o monólito (ADR-003) for revisada e os módulos passarem a se comunicar pela rede

---

## Notas

- Em aula, a diferença foi definida assim: um **comando** representa uma ação a ser executada (ex: `sendWelcomeEmail()`), enquanto um **evento** representa algo que aconteceu (ex: `restaurant.created`).
- Se eventos forem adotados no futuro, a escolha da tecnologia (RabbitMQ, Kafka, SQS/SNS etc.) deverá gerar um novo ADR.
- Relacionada: [ADR-003](./ADR-003-arquitetura-em-camadas.md), que já prevê a reavaliação caso a comunicação síncrona deixe de ser suficiente.

---

## Nota de implementação (2026-09-20)

O cenário descrito no contexto foi implementado, mantendo a decisão registrada
acima: **comunicação direta, síncrona, sem broker ou fila**.

- Onde: [`src/modules/notifications/notification.service.js`](../../src/modules/notifications/notification.service.js)
- Quem chama: o Restaurant Service, logo após gravar o restaurante
  ([`restaurant.service.js`](../../src/modules/restaurants/restaurant.service.js))
- O que acontece: as três reações previstas — e-mail de boas-vindas, registro
  de atividade e aviso ao time comercial

**Nada é enviado de verdade.** Cada ação é uma simulação que escreve uma linha
no log do servidor. Integrar um serviço de e-mail (SMTP, SendGrid, SES) traria
credenciais, indisponibilidade e custo — decisões que não cabem neste momento
do projeto e que, se fossem tomadas, mereceriam um ADR próprio. O destinatário
do aviso comercial vem da variável `COMMERCIAL_EMAIL` e tem como padrão
`comercial@easyfood.example`, no domínio reservado `.example`: nenhum endereço
real fica fixo no código.

A consequência negativa antecipada nesta ADR apareceu na prática já na
implementação: como a chamada é direta e síncrona, uma falha no envio poderia
derrubar um cadastro que já foi gravado no banco. Foi preciso proteger o
chamador com um `try/catch` — exatamente o tipo de remendo que uma arquitetura
orientada a eventos tornaria desnecessário, e que reforça o **critério de
revisão nº 2** registrado acima.

Verificação: `tests/notifications.test.js`.
