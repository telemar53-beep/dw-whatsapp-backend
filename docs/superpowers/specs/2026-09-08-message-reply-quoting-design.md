# Responder/citar mensagem (reply/quote) — Design

## Contexto

Hoje, dentro de uma conversa aberta, o atendente só consegue mandar mensagens soltas — não existe like o WhatsApp real, onde é possível selecionar uma mensagem específica do histórico e responder citando ela (o balãozinho de preview aparece tanto para quem compõe quanto na mensagem enviada, do lado de quem recebe).

Junto com esse pedido, o usuário também descreveu a semântica de "tracinhos" (✓ enviado, ✓✓ entregue/lido) do WhatsApp. Investigação: essa parte **já existe e está correta** — o componente `MessageStatusTicks.jsx` já implementa 1 check cinza (enviado), 2 checks cinza (entregue) e 2 checks coloridos (lido), mas só estava sendo usado na prévia da lista de conversas, nunca dentro das bolhas de mensagem da conversa aberta. **Essa parte já foi corrigida como um bug fix bounded, independente desta spec** (commit `ed2c516`) — o restante deste documento cobre só a funcionalidade de responder/citar, que é genuinamente nova.

## Escopo desta versão (decidido com o usuário)

- **Só o atendente inicia uma citação**, pelo nosso painel. O sistema NÃO interpreta/mostra quando o cliente cita uma mensagem pelo WhatsApp dele — isso fica para uma versão futura, se um dia for pedido.
- **Só mensagens com texto visível podem ser citadas** (mensagem de texto normal, ou mídia com legenda). Mídia sem legenda não fica disponível para citar — ver "Justificativa técnica" abaixo.
- Aplica-se aos dois tipos de canal (Baileys e Meta Cloud API), mas só ao envio de texto/mídia dentro de uma conversa já aberta — não se aplica ao envio de template (`sendTemplateMessage`), que é usado para iniciar conversa fora da janela de 24h e não faz sentido citar nada nesse contexto.
- Não cobre `ConversationHistoryModal` (histórico de conversas já fechadas) — só a conversa aberta em `ConversationView`, já que não dá pra mandar mensagem numa conversa fechada mesmo.
- Sem "clicar na citação para pular até a mensagem original" — só o preview visual, sem navegação.

### Justificativa técnica da restrição "só texto"

O Baileys precisa montar um objeto de citação (`quoted`) que inclui uma representação da mensagem original — não basta passar o ID, porque o protocolo do WhatsApp realmente empacota o conteúdo citado dentro da mensagem enviada (é assim que o destinatário renderiza a prévia, mesmo em uma arquitetura ponta-a-ponta). Reconstruir fielmente uma citação de mídia (imagem/áudio/vídeo) exigiria buscar o arquivo original de novo e montar um stub do tipo de mídia certo — passível de fazer depois, mas não faz parte desta entrega. Já a Meta Cloud API é mais simples (só manda o ID da mensagem original, a própria Meta resolve a citação do lado deles) — mas para manter os dois canais com a mesma regra e uma experiência previsível para o atendente, a restrição "só texto" vale para os dois.

## Modelo de dados

Uma migração nova, sem tabela nova:

```sql
ALTER TABLE messages ADD COLUMN replied_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
```

Auto-referenciando a própria tabela `messages`, nullable. `ON DELETE SET NULL` é só uma proteção defensiva — hoje não existe funcionalidade de apagar mensagem, então esse `ON DELETE` nunca dispara na prática, mas evita que a coluna vire uma referência quebrada se isso mudar no futuro.

**Abordagem escolhida (confirmada com o usuário): referência + busca ao carregar**, não cópia do conteúdo. Ao listar mensagens de uma conversa, um `LEFT JOIN` na própria tabela busca o conteúdo/direção da mensagem citada — mesmo padrão já usado no projeto para prévia da última mensagem nas listas de conversa (`LEFT JOIN LATERAL`). Menos dado duplicado, consistente com o resto do código.

## Backend

### `src/conversations/message.repository.js`

- `MESSAGE_COLUMNS` ganha `replied_to_message_id`.
- `toMessage(row)` ganha `repliedToMessageId: row.replied_to_message_id`.
- `createMessage(...)` ganha parâmetro opcional `repliedToMessageId`, incluído no INSERT.
- Nova função `toMessageWithReplyPreview(row)` (usada só por `listMessagesByConversation`) — estende `toMessage(row)` com `repliedToPreview: row.replied_to_message_id ? { content: row.replied_to_content, direction: row.replied_to_direction } : null`, mesma convenção já usada no projeto (`toConversation` → `toConversationSummary`).
- `listMessagesByConversation(conversationId)` — a query ganha `LEFT JOIN messages rm ON rm.id = m.replied_to_message_id`, selecionando `rm.content AS replied_to_content, rm.direction AS replied_to_direction` a mais, e usa `toMessageWithReplyPreview` no lugar de `toMessage`.
- `findMessageById` continua igual (usa `MESSAGE_COLUMNS`/`toMessage` sem o join — quem usa essa função hoje, `outbound-worker.js`, não precisa do preview, só dos campos crus).

### `src/api/conversations.routes.js` — `POST /:id/messages`

Novo campo opcional no corpo da requisição: `repliedToMessageId`. Validações, na ordem, antes de montar o payload de envio:

1. Se vier preenchido, busca via `findMessageById` (novo import nesse arquivo).
2. Não existe, ou pertence a outra conversa → 400.
3. `content` da mensagem original vazio/nulo (mídia sem legenda) → 400 "Only messages with text can be replied to".
4. `whatsappMessageId` da mensagem original ainda nulo (outbound ainda na fila, nunca chegou a ser realmente enviada) → 400 "This message has not been delivered yet".

Passando todas as validações, `repliedToMessageId` (o UUID validado) entra no payload passado para `enqueueOutboundMessage`.

### `src/queue/outbound-queue.js` — `enqueueOutboundMessage`

Ganha parâmetro opcional `repliedToMessageId`, passado para `createMessage` (persistido na coluna nova) e também incluído no payload do job do Bull (`repliedToMessageId || null`), mesmo padrão já usado para `templateName`/`headerType`/etc.

### `src/queue/outbound-worker.js`

O handler do job ganha `repliedToMessageId` na desestruturação. Se presente, busca a mensagem original via `findMessageById` (já importado nesse arquivo) e monta um objeto de contexto:
```js
{ repliedToWhatsappMessageId: original.whatsappMessageId, repliedToDirection: original.direction, repliedToContent: original.content }
```
Esse objeto é espalhado (`...replyContext`) no options object passado para `sendTextMessage`/`sendMediaMessage` do adaptador correspondente. Se a mensagem original não for encontrada por algum motivo (não deveria acontecer, já que a validação da rota já confirmou sua existência), o envio simplesmente segue sem citação em vez de falhar — a citação é cosmética, não deve impedir a mensagem de ser entregue.

### `src/whatsapp-adapters/baileys.manager.js`

`sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId, repliedToDirection, repliedToContent } = {})` — 4º parâmetro novo, opcional. Quando `repliedToWhatsappMessageId` está presente, monta:
```js
{
  quoted: {
    key: { remoteJid: jid, id: repliedToWhatsappMessageId, fromMe: repliedToDirection === 'outbound' },
    message: { conversation: repliedToContent },
  },
}
```
e passa como 3º argumento de `entry.sock.sendMessage(jid, { text: content }, options)`. Sem citação, passa `undefined` no lugar de `options` (comportamento idêntico ao atual).

`sendMediaMessage(channel, toPhoneNumber, { ..., repliedToWhatsappMessageId, repliedToDirection, repliedToContent })` — mesmos 3 campos novos e opcionais no objeto de opções já existente, mesma lógica de montar `quoted`, passado como 3º argumento do `sendMessage`.

### `src/whatsapp-adapters/meta-cloud.adapter.js`

`sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId } = {})` — quando presente, adiciona `context: { message_id: repliedToWhatsappMessageId }` no corpo da requisição JSON.

`sendMediaMessage(channel, toPhoneNumber, { ..., repliedToWhatsappMessageId })` — mesmo campo `context` adicionado ao `messagePayload` já existente.

(`repliedToDirection`/`repliedToContent` não são usados pela Meta Cloud — só o Baileys precisa deles para montar o stub da citação.)

## Frontend

### `ConversationView.jsx`

- Novo estado local: `replyingTo` (objeto da mensagem sendo respondida, ou `null`).
- Cada bolha de mensagem com `content` preenchido ganha um botão "↩" (sempre visível, não só ao passar o mouse — mantém simples, evita estado extra de hover) — só aparece quando `isMine` (só faz sentido responder numa conversa que você pode enviar mensagem). `onClick` seta `replyingTo` para aquela mensagem.
- Cada bolha que tem `repliedToPreview` (vindo do backend) mostra uma caixinha pequena acima do conteúdo, com o texto citado (truncado) e um rótulo: `repliedToPreview.direction === 'outbound'` → "Você"; `direction === 'inbound'` → o nome/telefone do contato da própria conversa (`conversation.contactDisplayName || conversation.contactPhoneNumber`, mesmo fallback já usado no cabeçalho).
- `MessageInput` ganha duas props novas: `replyingTo` e `onCancelReply`.
- A função que hoje só chama `sendMessage(content, file)` passa a ser: `async function handleSend(content, file, repliedToMessageId) { await sendMessage(content, file, repliedToMessageId); setReplyingTo(null); }` — passada como `onSend` para `MessageInput`. Em caso de erro, `replyingTo` continua selecionado (mesma lógica já existente para não perder o texto digitado quando o envio falha).

### `MessageInput.jsx`

- Continua um componente "burro", só recebe props (`replyingTo`/`onCancelReply` novos, além dos já existentes).
- Quando `replyingTo` está preenchido, renderiza uma barra de preview acima da caixa de texto — prévia curta do conteúdo citado + botão "X" que chama `onCancelReply`.
- `handleSubmit` passa a chamar `onSend(content, file, replyingTo ? replyingTo.id : null)`.

### `useConversationMessages.js` / `services/api.js`

- `sendMessage` (usado por `useConversationMessages`, que chama `apiSendMessage`) ganha um 3º parâmetro opcional `repliedToMessageId`, incluído no corpo/form-data enviado para `POST /:id/messages`.

## Erros e casos de borda

- Responder uma mensagem de mídia sem legenda → 400 no backend; no frontend, o botão "↩" simplesmente não aparece nessas bolhas (sem `content`), então esse erro nunca chega a ser tentado pela UI normal — só relevante para uma chamada direta à API.
- Responder uma mensagem outbound que ainda está na fila (sem `whatsappMessageId`) → 400; no frontend, isso é uma corrida rara (a mensagem apareceria imediatamente na tela como enviada, mas com status ainda "sent" — o botão "↩" fica disponível de qualquer forma, sem checagem prévia no frontend, já que checar isso na hora de mostrar o botão exigiria lógica duplicada; se acontecer, o atendente só vê o erro de envio já mostrado por `MessageInput` e tenta de novo em instantes).
- Mensagem original não encontrada no momento real do envio (deletada — hoje impossível, mas defensivo) → envia sem citação em vez de falhar, conforme já descrito acima.

## Testes

- Backend: `message.repository.test.js` (nova função `createMessage` com `repliedToMessageId`, `listMessagesByConversation` retornando `repliedToPreview`), `conversations.routes.test.js` (as 3 validações novas + o caminho feliz passando `repliedToMessageId` adiante), `outbound-queue.test.js`/`outbound-worker.test.js` (campo novo passado adiante, busca da mensagem original, envio segue sem citação se a original não for encontrada), `baileys.manager.test.js`/`meta-cloud.adapter.test.js` (`quoted`/`context` montados corretamente quando presentes, comportamento idêntico ao atual quando ausentes).
- Frontend: `ConversationView.test.jsx` (botão de responder aparece/some conforme `content`/`isMine`, clicar seta o estado, preview da citação aparece numa bolha recebida), `MessageInput.test.jsx` (barra de preview aparece/some, cancelar limpa, `onSend` recebe o terceiro parâmetro certo).

## Fora de escopo

- Cliente citando uma mensagem pelo WhatsApp dele (detecção do lado de entrada).
- Citar mensagens de mídia sem legenda.
- Clicar na citação para pular até a mensagem original.
- Responder dentro do histórico de conversas fechadas (`ConversationHistoryModal`).
- Citar ao enviar um template (`sendTemplateMessage`).
