# Disparo em massa / campanha

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-11

## 1. Problema e objetivo

Hoje o sistema só permite iniciar uma conversa por vez (`POST /api/conversations/start`),
um número de cada vez, digitado manualmente por um atendente. O usuário quer mandar a
mesma mensagem para uma lista de clientes de uma vez (ex: aviso de manutenção
programada, cobrança em massa) — um caso de uso comum para uma prestadora de internet.

Esta é a 1ª de 4 features levantadas numa mesma conversa (as outras 3 — nota interna no
contato, auto-resposta por horário de atendimento, exportar relatório — são
subsistemas independentes e ficam para specs próprias, em ordem, depois desta).

Decisões tomadas com o usuário durante o brainstorm:
- **Lista de destinatários:** colada em texto (um telefone por linha, opcionalmente
  `telefone,nome`) — sem upload de arquivo por enquanto.
- **Canais permitidos:** tanto oficiais (Meta Cloud/360dialog, exige template aprovado)
  quanto Baileys (texto livre) — mesmo com o risco real de banimento do número não
  oficial em uso automatizado/massivo, aceito conscientemente pelo usuário. O sistema
  aplica um ritmo de envio conservador por padrão como mitigação.
- **Personalização:** a mesma mensagem/template (com as mesmas variáveis, se houver)
  para todos os destinatários da campanha — sem substituição por destinatário nesta
  versão.
- **Quem pode disparar:** qualquer atendente autenticado, mesmo padrão de "Iniciar
  conversa" hoje.
- **Dono da conversa quando o cliente responde:** a conversa nasce na fila
  compartilhada ("aguardando"), sem atribuição automática a quem disparou a campanha,
  e **sem** a mensagem de abertura/protocolo que `POST /start` manda hoje — essa
  mensagem faz sentido para um atendimento 1:1 iniciado por uma pessoa, não para um
  disparo em massa.

## 2. Modelo de dados

Duas tabelas novas:

```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  channel_id UUID NOT NULL REFERENCES channels(id),
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'template')),
  content TEXT,
  template_id UUID REFERENCES templates(id),
  template_variables JSONB,
  created_by UUID NOT NULL REFERENCES agents(id),
  total_recipients INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  raw_phone_number TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  contact_id UUID REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX campaign_recipients_campaign_id_idx ON campaign_recipients(campaign_id);
```

`message_type = 'text'` é usado com canais Baileys (`content` preenchido,
`template_id`/`template_variables` nulos); `message_type = 'template'` é usado com
canais oficiais (`template_id`/`template_variables` preenchidos, `content` nulo) —
mesma distinção que `POST /start` já faz hoje por tipo de canal.

## 3. Backend

**`src/campaigns/campaign.repository.js`** (novo): `createCampaign`,
`findCampaignById`, `listCampaigns`, `createCampaignRecipients` (insere em lote),
`listCampaignRecipients(campaignId)`, `updateCampaignRecipientStatus(id, {status,
errorMessage, contactId, conversationId})`, `incrementCampaignCounters(campaignId,
{sent, failed, skipped})`.

**`src/queue/campaign-queue.js`** (novo, mesmo padrão de `outbound-queue.js`): fila Bull
`campaign-messages` com `limiter: { max: 20, duration: 60000 }` (20 mensagens por
minuto, ~1 a cada 3s — mesmo teto para os dois tipos de canal nesta primeira versão).
`enqueueCampaignRecipient({recipientId, campaignId, channelId, phoneNumber,
displayName, messageType, content, templateId, templateVariables})` adiciona um job por
destinatário.

**`src/campaigns/campaign-processor.js`** (novo, o handler que a fila chama por job):
1. Normaliza o telefone (mesmo `replace(/\D/g, '')` já usado em `/start`); se vazio,
   marca `failed` ("número inválido") e sai.
2. Canal Baileys: `baileysManager.resolveWhatsAppJid(channel, phoneNumber)` — se `null`,
   marca `failed` ("número não está no WhatsApp") e sai. Canal oficial: usa o número
   normalizado diretamente (mesma lógica de `/start`).
3. `findOrCreateContactByPhoneNumber(canonicalPhoneNumber, displayName || null)`.
4. `findOpenConversation(contact.id, channel.id)` — se já existe qualquer conversa não
   fechada (inclusive uma `'silent'`, dormente por automação SGP — ao contrário de
   `/start`, a campanha nunca adota/reivindica uma conversa existente), marca `skipped`
   ("já tem conversa em andamento") e sai. Evita inserir uma mensagem de campanha numa
   conversa que já existe por outro motivo.
5. Senão, `createConversation(contact.id, channel.id)` (status `'waiting'` por padrão —
   **não chama `claimConversation`**, ao contrário de `/start`).
6. `enqueueOutboundMessage({conversationId, channelId, content, templateName,
   templateLanguage, templateVariables})` — mesma função já usada por todo envio de
   saída do sistema (grava a mensagem, entra na fila de entrega com retry).
7. Marca o destinatário `sent`, incrementa o contador da campanha correspondente
   (`sent`/`failed`/`skipped`).

Erros não previstos (ex: `enqueueOutboundMessage` lançar exceção) são capturados e
tratados como `failed` com a mensagem do erro — um destinatário com problema nunca
derruba o processamento dos demais (Bull já isola falha de job).

**`src/api/campaigns.routes.js`** (novo, montado em `/api/campaigns`, `requireAuth` em
tudo — qualquer atendente):
- `POST /` — body `{name?, channelId, content}` (Baileys) ou `{name?, channelId,
  templateId, templateVariables}` (oficial), mais `recipients` (string bruta colada,
  uma linha por destinatário, `telefone` ou `telefone,nome`). Valida o canal e o
  template exatamente como `/start` já valida hoje. Faz o parse da lista: ignora linhas
  em branco, normaliza e deduplica telefones (mantém a 1ª ocorrência), separa linhas
  com telefone vazio/sem dígitos como recipients já `failed` desde a criação. Se
  **nenhuma** linha resultar em destinatário válido (mesmo entre os `failed`), 400. Cria
  a campanha + os `campaign_recipients` (todos, incluindo os já `failed` do parse), e
  para cada um que ainda está `pending` chama `enqueueCampaignRecipient`. Retorna a
  campanha criada (`201`).
- `GET /` — lista campanhas (mais recentes primeiro), com os contadores.
- `GET /:id` — detalhe da campanha + lista de destinatários com status individual.

## 4. Frontend

Nova página `CampaignsPage.jsx`, roteada em `/campaigns`, com um item novo na
`NavRail.jsx` (visível a qualquer atendente, mesmo padrão de "Conversas"/"Relatório").

- **Lista de campanhas:** cada linha mostra nome, canal, quando foi criada, e um resumo
  dos contadores (ex: "42 enviados, 2 falharam, 1 pulado de 45"). Botão "Nova campanha".
- **`CreateCampaignModal.jsx`:** seleciona o canal (reaproveita `useChannelsForAgent`
  já existente); se Baileys, campo de texto livre; se oficial, seletor de template
  aprovado + campos de variável (mesmo componente/lógica já usada em
  `StartConversationModal.jsx` para templates); um `<textarea>` para colar a lista de
  números (uma linha por destinatário); botão "Disparar" chama `POST /api/campaigns`.
- **`CampaignDetailPage.jsx` (ou modal):** mostra os contadores atualizando sozinhos a
  cada 3s via polling em `GET /api/campaigns/:id` enquanto `sent_count + failed_count +
  skipped_count < total_recipients` (mesmo padrão já usado no polling de QR code em
  `AdminChannelsPage`), e a lista de destinatários com o status de cada um.

## 5. Erros e casos de borda

- `POST /` com canal Baileys desconectado, ou canal oficial com template não aprovado
  ou contagem de variáveis errada → 400 (mesmas mensagens de erro que `/start` já usa).
- Lista colada vazia ou só com linhas em branco → 400 ("recipients é obrigatório").
- Lista onde toda linha é inválida (sem nenhum dígito) → 400 (nenhum destinatário válido
  para processar).
- Um destinatário específico falhando (número inválido, não está no WhatsApp, erro ao
  enviar) nunca aborta os demais — cada um processa isoladamente.
- Destinatário que já tem conversa aberta no mesmo canal não recebe a mensagem da
  campanha (marcado `skipped`) — evita inserir uma mensagem de campanha dentro de uma
  conversa 1:1 já em andamento.

## 6. Testes

- Backend: `campaign.repository.test.js` (criar/listar campanha e destinatários,
  atualizar status, incrementar contadores); `campaign-processor.test.js` (os 4
  caminhos — enviado, pulado por conversa aberta, falhou por número inválido, falhou
  por não estar no WhatsApp — com os adaptadores/repositórios mockados);
  `campaigns.routes.test.js` (validação de criação — canal, template, lista vazia,
  linha inválida —, listagem, detalhe, autenticação).
- Frontend: `CampaignsPage.test.jsx`, `CreateCampaignModal.test.jsx` (parse da lista
  colada, validação de campos conforme o tipo de canal), `CampaignDetailPage.test.jsx`
  (polling e exibição de status por destinatário).

## 7. Fora de escopo (YAGNI, deliberado)

- Upload de arquivo CSV real (só colar texto por enquanto).
- Personalização por destinatário (variáveis diferentes por linha).
- Segmentação por cidade/filtro de contatos já cadastrados (só lista colada).
- Rastreamento de status de entrega/leitura por destinatário da campanha — "enviado"
  significa "entrou na fila de saída", igual ao resto do sistema; confirmação de
  entrega real só existe por mensagem individual, abrindo a conversa.
- Pausar/cancelar uma campanha em andamento.
- Campanha só admin — decidido que qualquer atendente pode disparar.
