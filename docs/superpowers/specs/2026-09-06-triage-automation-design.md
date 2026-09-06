# Triagem automática por bot (DW Telecom)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md), [2026-09-06-agent-sectors-design.md](2026-09-06-agent-sectors-design.md)

## Contexto e motivação

Hoje toda conversa nasce direto na fila geral, sem nenhuma triagem — o
primeiro atendente disponível assume qualquer coisa, sem saber de antemão
do que se trata. Este recurso adiciona um bot simples que faz **uma única
pergunta** ao cliente assim que a conversa começa, para descobrir qual
setor deve atendê-lo, e etiqueta a conversa na fila com esse setor — sem
mudar quem pode assumir o quê.

Setores (`sectors`/`agent_sectors`) já existem no sistema como metadado
organizacional puro, sem função de roteamento. Este recurso não muda isso:
a triagem só rotula a conversa, não restringe a fila.

**Explicitamente fora deste recurso:** a integração existente entre SGP
(sistema de gestão do provedor) e o WhatsApp para envio automático de
boletos/cobrança — isso é um assunto separado, levantado só como contexto,
que pode virar uma spec própria no futuro.

## Escopo

**Dentro do escopo:**
- Uma pergunta única, configurável pelo admin, disparada automaticamente
  na primeira mensagem de toda conversa nova, em qualquer canal com a
  triagem ligada.
- Lista de opções configurável, cada uma associada a um setor e a uma
  lista de frases-gatilho — o cliente pode responder com o número da
  opção ou com uma frase que contenha um dos gatilhos cadastrados.
- Número máximo de tentativas configurável; ao esgotar, a conversa cai na
  fila geral sem setor definido.
- Mensagem de confirmação configurável, enviada quando a triagem termina
  (com ou sem setor definido).
- Liga/desliga por canal (uma configuração de pergunta/opções só, cada
  canal decide se usa).
- A conversa aparece na fila normalmente desde a primeira mensagem,
  mostrando uma etiqueta de setor assim que a triagem resolver.
- Se um atendente assumir a conversa enquanto a triagem ainda está
  pendente, ela é cancelada na hora.
- Nova aba "Triagem" na administração para configurar tudo isso; novo
  checkbox por canal na aba "Canais".

**Fora do escopo (aceito como está, não é um gap a corrigir aqui):**
- Filtrar a fila por setor do atendente — a etiqueta é só informativa.
- Múltiplas perguntas ou árvore de decisão — é sempre uma única pergunta.
- Configuração de pergunta/opções diferente por canal — é uma configuração
  só, compartilhada; o canal apenas liga ou desliga.
- Qualquer integração com SGP ou automação de cobrança.
- Métricas específicas de triagem (ex: quantas conversas caíram em cada
  setor) — o dado (`conversations.sector_id`) fica salvo e disponível para
  uma spec futura de métricas, se quiserem.

## Decisão de arquitetura

### Modelo de dados

Quatro mudanças, nenhuma quebra o que já existe:

- `channels.triage_enabled` (boolean, default `false`) — liga/desliga a
  triagem para aquele canal especificamente.
- `triage_config` (linha única — sempre `id = 1`): `question_text`,
  `confirmation_text`, `max_attempts` (inteiro, ex: 2).
- `triage_options`: `id`, `option_number` (inteiro, a ordem/número que o
  cliente digita), `sector_id` (FK para `sectors`), `keywords` (array de
  texto, ex: `{financeiro, conta, fatura, boleto}`). Sem tabela de junção
  — cada opção aponta pra exatamente um setor.
- `conversations.sector_id` (FK nula para `sectors`) — setor definido pela
  triagem; nulo se a triagem nunca rodou, está em andamento, ou esgotou as
  tentativas sem bater com nenhuma opção.
- `conversations.triage_state` (texto nulo: `'pending'` ou `'completed'`)
  — `'pending'` enquanto o bot está esperando resposta; `'completed'`
  quando a triagem terminou (com ou sem setor) ou foi cancelada por um
  atendente assumindo; `null` para conversas em canais sem triagem
  (comportamento de hoje, sem mudança).
- `conversations.triage_attempts` (inteiro, default `0`) — contador de
  tentativas inválidas, usado para comparar com `triage_config.max_attempts`.

### Fluxo do bot

Tudo dentro de `ingestInboundMessage` (o ponto único onde toda mensagem
recebida, de qualquer canal, já passa hoje):

1. **Conversa nova, canal com `triage_enabled = true`:** depois de criar a
   conversa (`createConversation`), marca `triage_state = 'pending'` e
   enfileira a `question_text` como a primeira mensagem de saída
   (`enqueueOutboundMessage`, reaproveitando a fila Bull já existente).
   Conversa nova em canal sem triagem: comportamento de hoje, sem mudança
   (`triage_state` fica `null`).
2. **Mensagem recebida numa conversa com `triage_state = 'pending'`:** a
   mensagem é salva normalmente no histórico (like sempre), e o conteúdo é
   comparado com as `triage_options`: bate se for exatamente o
   `option_number` (ex: cliente digita "2") OU se o texto (sem diferenciar
   maiúsculas/minúsculas) contém qualquer uma das `keywords` daquela
   opção. Em caso de mais de uma opção bater, vale a primeira por ordem de
   `option_number`.
   - **Bateu:** grava `conversations.sector_id`, marca
     `triage_state = 'completed'`, envia `confirmation_text`.
   - **Não bateu:** incrementa `triage_attempts`. Se ainda não passou de
     `max_attempts`, reenvia `question_text`. Se passou, marca
     `triage_state = 'completed'` com `sector_id` nulo (cai na fila geral)
     e ainda envia `confirmation_text` (a mensagem de confirmação serve
     tanto pro caminho de sucesso quanto pro de "vai pra fila geral" —
     o texto configurado deve funcionar pros dois casos, ex: "Obrigado!
     Você será atendido em breve.").
3. **Atendente assume a conversa (`claimConversation`) enquanto
   `triage_state = 'pending'`:** o `UPDATE` que já faz o claim também seta
   `triage_state = 'completed'` na mesma transação — nenhuma mensagem nova
   do bot sai depois disso. Corrige a corrida em que o cliente responde à
   pergunta quase no mesmo instante em que alguém assume: a checagem de
   "ainda está pending" acontece direto no banco a cada mensagem recebida,
   então se o claim já rodou primeiro, a mensagem seguinte do cliente só
   é salva normalmente, sem o bot reagir.

A conversa aparece na fila (`GET /api/conversations/queue`) desde a
primeira mensagem, com ou sem `sector_id` definido ainda — o evento de
socket `queue:new` (que já faz upsert por id) naturalmente atualiza a
etiqueta ao vivo quando a triagem resolver, sem precisar de nenhum evento
novo.

### Interface administrativa

Nova aba "Triagem" na tela de administração (mesmo padrão de
Canais/Atendentes/Respostas rápidas/Setores): formulário para a pergunta,
a mensagem de confirmação, o número máximo de tentativas, e uma lista de
opções (cada uma com um seletor de setor e um campo de texto para as
frases-gatilho, separadas por vírgula). A aba "Canais" ganha um checkbox
"Usar triagem automática" por linha de canal — `admin-channels.routes.js`
hoje só tem `GET`/`POST` (nenhuma rota de atualização), então esse
checkbox precisa de uma nova rota `PATCH /api/admin/channels/:id` (mesmo
padrão de `PATCH /api/admin/agents/:id`, que já faz esse tipo de toggle
pontual) para alternar `triage_enabled`.

### Frontend (fila de atendimento)

`ConversationListItem` (usado tanto na fila quanto em "minhas conversas")
mostra uma etiqueta com o nome do setor quando `conversation.sectorId`
existe — sem etiqueta quando é nulo (triagem não rodou, está em
andamento, ou caiu na fila geral).

## Testes

Mesmo padrão do projeto: testes de unidade para a lógica de casamento de
opções (número exato, frase-gatilho, case-insensitive, múltiplas opções
batendo escolhe a de menor número, nenhuma opção bate); testes de
integração para o fluxo completo dentro de `ingestInboundMessage` (banco
de teste real, cobrindo: primeira mensagem dispara a pergunta e marca
pending; resposta válida define setor e completa; resposta inválida
repete até o limite; esgotar tentativas cai na fila geral; canal sem
triagem não é afetado; claim durante pending cancela a triagem); testes de
componente para a nova aba de administração e para a etiqueta de setor na
lista de conversas.

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para
transformar isso num plano de implementação detalhado.
