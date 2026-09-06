# Atendente iniciar conversa (somente Baileys)

**Data:** 2026-09-06
**Status:** Aprovado para planejamento de implementação
**Estende:** [2026-09-04-whatsapp-attendance-system-design.md](2026-09-04-whatsapp-attendance-system-design.md)

## Contexto e motivação

Hoje toda conversa nasce dentro de `ingestInboundMessage`, disparada por uma mensagem recebida via webhook — não existe nenhum fluxo equivalente a "criar conversa vazia e mandar a primeira mensagem". Isso é uma limitação real: um atendente da DW Telecom às vezes precisa contatar um cliente proativamente (avisar sobre uma manutenção agendada, confirmar um agendamento, retornar um contato perdido), e hoje não tem como.

O usuário identificou, ainda no brainstorming da spec de mídia, que esse recurso tem uma complicação: a API oficial (Meta Cloud) exige que mensagens iniciadas pela empresa fora da janela de 24h usem um *template* pré-aprovado pela Meta — um conceito que não existe hoje no sistema (cadastro de template, idioma, variáveis, acompanhamento de status pending/approved/rejected). O Baileys (WhatsApp não oficial), por outro lado, não tem essa exigência: um atendente pode simplesmente mandar uma mensagem para qualquer número, como no WhatsApp comum.

Para não bloquear o recurso mais simples e mais pedido atrás do trabalho de templates da Meta, esta entrega cobre **somente conversas iniciadas por canais Baileys**. Uma segunda spec, focada em templates da Meta e iniciar conversa pelo Meta Cloud, fica para depois — está fora do escopo deste documento.

## Escopo

**Dentro do escopo:**
- Atendente digita um número de telefone, escolhe um canal Baileys conectado, escreve a primeira mensagem, e a conversa é criada e enviada.
- A conversa criada já nasce atribuída a quem a iniciou (mesmo comportamento de "assumir").
- Se já existe uma conversa aberta com aquele cliente naquele canal, a criação é rejeitada com uma mensagem clara — não permite duplicar.

**Fora do escopo (fica para a próxima spec):**
- Iniciar conversa por um canal Meta Cloud.
- Cadastro de templates de mensagem da Meta (nome, categoria, idioma, corpo com variáveis) e acompanhamento de status de aprovação (pending/approved/rejected).
- Qualquer envio do tipo `template` na Graph API.

## Decisão de arquitetura

### Backend — fluxo de criação

Nova rota `POST /api/conversations/start`, autenticada (`requireAuth`, já aplicado a todo o router via `router.use(requireAuth)`), recebendo `{ channelId, phoneNumber, content }`.

A rota reaproveita quase 100% do que já existe, na seguinte ordem:

1. **Valida o canal:** busca com `findChannelById(channelId)` (`src/channels/channel.repository.js`). Se não existir → 404. Se `channel.type !== 'baileys'` → 400 com uma mensagem explícita ("Iniciar conversa só é suportado para canais Baileys nesta versão"). Se `channel.status !== 'connected'` → 400 ("Este canal não está conectado").
2. **Normaliza o telefone:** remove tudo que não for dígito (`phoneNumber.replace(/\D/g, '')`) — mesmo formato usado hoje em `sendTextMessage`/`sendMediaMessage` do Baileys, que montam o JID como `` `${toPhoneNumber}@s.whatsapp.net` ``. Um número vazio após a normalização → 400.
3. **Acha ou cria o contato:** `findOrCreateContactByPhoneNumber(phoneNumber, null)` (`src/conversations/contact.repository.js`) — sem nome de exibição, já que quem está criando o contato é o atendente, não uma mensagem recebida com nome do WhatsApp.
4. **Confirma que não há conversa aberta:** `findOpenConversation(contact.id, channel.id)` (`src/conversations/conversation.repository.js`). Se retornar uma conversa → 409 com uma mensagem clara ("Já existe um atendimento em andamento com este cliente neste canal").
5. **Cria a conversa:** `createConversation(contact.id, channel.id)`.
6. **Atribui automaticamente a quem iniciou:** `claimConversation(conversation.id, req.agent.agentId)` — reaproveita a função já usada pela rota `/:id/claim`, sem lógica nova de atribuição.
7. **Envia a primeira mensagem:** `enqueueOutboundMessage(...)` — mesma fila de saída já usada pela rota `/:id/messages` para mensagens de texto.
8. **Emite em tempo real:** `emitToAgent(req.agent.agentId, 'conversation:assigned', { conversation: conversationWithContact })` — o mesmo evento e mesmo formato de payload que a rota `/:id/claim` já emite hoje, para a tela do atendente abrir a conversa nova automaticamente sem precisar dar refresh.
9. Responde 201 com a conversa criada (mesmo formato de `getConversationWithContact`).

Nenhuma tabela nova, nenhuma coluna nova — o recurso é inteiramente composição de funções que já existem.

### Frontend — entrada e formulário

Um botão "Iniciar conversa" no `DashboardPage`, perto das listas de fila/minhas conversas, abre um modal (`StartConversationModal`, mesmo padrão de `TransferModal`/`ChangePasswordModal`/`ConversationHistoryModal` já usados no projeto). O modal tem três campos:
- **Canal:** `<select>` populado a partir do hook já existente `useChannels`, filtrado para `type === 'baileys' && status === 'connected'` — um canal Meta Cloud ou um Baileys desconectado simplesmente não aparece na lista, evitando que o atendente escolha uma opção inválida pela UI (a validação do backend continua sendo a garantia real).
- **Telefone:** campo de texto livre (o backend normaliza; não há máscara obrigatória).
- **Mensagem:** `<textarea>` com a primeira mensagem a enviar.

Se a lista de canais elegíveis vier vazia, o modal mostra "Nenhum canal Baileys conectado no momento" no lugar do `<select>`, sem bloquear a abertura do modal.

Ao confirmar, o modal chama uma nova função `startConversation({ channelId, phoneNumber, content }, token)` em `frontend/src/services/api.js` (`POST /api/conversations/start`, mesmo padrão de `apiFetch` já usado por todas as outras chamadas). Em caso de sucesso, o modal fecha e a conversa retornada é aberta diretamente na tela principal — o mesmo comportamento de quando `conversation:assigned` chega por socket hoje (a lista "Minhas conversas" já reage a esse evento; o `POST` só precisa devolver a conversa criada para a UI poder selecioná-la imediatamente, sem esperar o round-trip do socket).

### Tratamento de erros

Os três erros de validação do backend (canal não é Baileys, canal não conectado, conversa já aberta) chegam ao frontend como `ApiError` com `status` e `body.error` (mesmo padrão já usado em toda a base) e são exibidos como uma mensagem de erro simples dentro do próprio modal, sem fechar — o atendente pode corrigir e tentar de novo (trocar o número, escolher outro canal) sem perder o que já digitou.

## Testes

Mesmo padrão já usado no projeto inteiro:
- **Backend:** teste de integração da rota `POST /api/conversations/start` cobrindo os casos: canal inexistente (404), canal Meta Cloud (400), canal Baileys desconectado (400), telefone vazio após normalização (400), conversa já aberta com o contato no canal (409), e o caminho feliz (201, conversa criada já atribuída ao atendente que chamou, mensagem enfileirada, evento `conversation:assigned` emitido). A fila de saída (`enqueueOutboundMessage`) e o socket (`emitToAgent`) continuam mockados, como em todos os testes existentes das rotas de conversa.
- **Frontend:** teste do `StartConversationModal` cobrindo: lista de canais filtrada (só Baileys conectado aparece), submissão com sucesso chamando `startConversation` com os valores corretos, e exibição da mensagem de erro quando a API rejeita (409/400) sem fechar o modal.
- **Manual:** ao final da implementação, um teste real como já foi feito para mídia — iniciar uma conversa de verdade pelo canal Baileys de testes ("Berg") para um número de celular real, confirmando que a mensagem chega no WhatsApp do cliente e que a conversa aparece corretamente na tela do atendente.

## Próximos passos

Com o spec aprovado, o próximo passo é usar a skill `writing-plans` para transformar isso num plano de implementação detalhado. A spec de templates da Meta + iniciar conversa pelo Meta Cloud fica registrada como próximo item da fila, fora do escopo deste documento.
