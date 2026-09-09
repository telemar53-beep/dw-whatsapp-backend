# Mensagem de boas-vindas por canal — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement the plan derived from this spec.

## Contexto e objetivo

Primeira de três entregas relacionadas que o usuário pediu de uma vez
(brainstorm decompôs em sub-projetos): mensagem de boas-vindas por canal,
mensagem de encerramento por canal, e um aviso condicional por cidade — as
outras duas ficam para specs futuras, mas o mecanismo desta precisa deixar
o caminho aberto para elas (confirmado no brainstorm: quando o aviso por
cidade existir, o cliente daquela cidade recebe a boas-vindas normal **e**
o aviso, duas mensagens separadas — não uma substituindo a outra).

Hoje, quando uma conversa nova começa, o único comportamento automático que
existe é a **triagem** (`src/triage/`): um menu de opções pergunta o setor,
mas só se o canal tiver `triage_enabled = true` e existirem opções
cadastradas. Não existe nenhuma mensagem de saudação simples, independente
da triagem.

**Decisões já tomadas durante o brainstorm (não reabrir):**
- Boas-vindas é separada da triagem — funciona com ou sem triagem ativada
  no canal.
- Texto diferente por canal (não um texto único ligado/desligado por
  canal) — os canais representam escritórios/cidades diferentes.
- Dispara em toda conversa nova (não só na primeiríssima vez do contato) —
  se o cliente encerrou e volta depois, recebe a boas-vindas de novo.
- Quando um canal tem as duas coisas ativadas: boas-vindas primeiro, menu
  de triagem logo em seguida (duas mensagens separadas).
- Texto fixo por enquanto, sem variáveis (nome do cliente etc.) — pode ser
  adicionado depois se fizer falta.
- Na tela de admin, a aba "Respostas rápidas" vira **"Mensagens"** e ganha
  uma seção nova para a boas-vindas, ao lado da lista de respostas rápidas
  que já existe (não uma aba separada).

## Modelo de dados

Uma coluna nova em `channels`, seguindo o mesmo padrão já usado por
`waba_id` (dado por canal direto na tabela, sem tabela auxiliar):

```sql
ALTER TABLE channels ADD COLUMN welcome_message TEXT;
```

`NULL` (ou string vazia, tratada como `NULL` na escrita) = boas-vindas
desativada nesse canal — o próprio conteúdo do campo já carrega a
informação de ligado/desligado, sem precisar de um booleano `*_enabled`
separado (diferente do padrão da triagem, que separa `triage_enabled` de
um texto de pergunta global — aqui não faz sentido porque o texto já é por
canal, "tem texto" já significa "está ativa").

## Backend

### `src/channels/channel.repository.js`

- `toChannel(row)` ganha `welcomeMessage: row.welcome_message`.
- Todo `SELECT`/`RETURNING` que já lista as colunas de `channels`
  (`createChannel`, `findChannelById`, `findChannelByMetaPhoneNumberId`,
  `findChannelByWabaId`, `listChannels`, `updateChannelStatus`,
  `updateChannelTriageEnabled`, `updateChannelWabaId`,
  `updateChannelHidden`) ganha `welcome_message` na lista de colunas —
  mesmo padrão já seguido quando `hidden` foi adicionado.
- Nova função, mesmo formato de `updateChannelWabaId`:
  ```js
  async function updateChannelWelcomeMessage(id, welcomeMessage) {
    const result = await getPool().query(
      `UPDATE channels SET welcome_message = $2 WHERE id = $1
       RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
      [id, welcomeMessage]
    );
    if (result.rowCount === 0) return null;
    return toChannel(result.rows[0]);
  }
  ```
  `welcomeMessage` chega já normalizado pelo route handler (string
  não-vazia ou `null` — nunca string vazia direto no banco).

### `src/api/admin-channels.routes.js`

O `PATCH /:id` já existente ganha um quarto campo opcional, mesmo padrão
dos outros três (`triageEnabled`, `wabaId`, `hidden`):

```js
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { triageEnabled, wabaId, hidden, welcomeMessage } = req.body || {};
  if (triageEnabled === undefined && wabaId === undefined && hidden === undefined && welcomeMessage === undefined) {
    return res.status(400).json({ error: 'triageEnabled, wabaId, hidden or welcomeMessage is required' });
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'hidden must be a boolean' });
  }
  if (welcomeMessage !== undefined && typeof welcomeMessage !== 'string') {
    return res.status(400).json({ error: 'welcomeMessage must be a string' });
  }
  let channel;
  // ...blocos já existentes de triageEnabled/wabaId/hidden, inalterados...
  if (welcomeMessage !== undefined) {
    channel = await updateChannelWelcomeMessage(req.params.id, welcomeMessage.trim() || null);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  res.json(toChannelResponse(channel));
});
```

`welcomeMessage: ''` (string vazia, inclusive só espaços) e
`welcomeMessage: null` fazem a mesma coisa — desativam a boas-vindas
daquele canal, gravando `NULL`. Isso é diferente de `wabaId`, que rejeita
string vazia com 400 (lá "vazio" não faz sentido; aqui "vazio" é o próprio
mecanismo de desligar).

`toChannelResponse` (helper que já existe no arquivo, linhas 39-50) ganha
`welcomeMessage`:

```js
function toChannelResponse(channel) {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
    hidden: channel.hidden,
    welcomeMessage: channel.welcomeMessage,
    wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
  };
}
```

### `src/conversations/inbound-message.service.js`

O bloco que hoje só decide sobre triagem:

```js
if (justCreated && conversation.triageState === 'pending') {
  await sendTriageQuestion(conversation.id, channelId);
} else if (!justCreated && conversation.triageState === 'pending') {
  conversation = await processTriageReply(conversation, channelId, content);
}
```

passa a também disparar a boas-vindas, **antes** da pergunta de triagem,
só quando `justCreated` (nunca em réplica de triagem — esse ramo já não é
"conversa nova"):

```js
if (justCreated) {
  const channel = await findChannelById(channelId);
  if (channel.welcomeMessage) {
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: channel.welcomeMessage });
  }
  if (conversation.triageState === 'pending') {
    await sendTriageQuestion(conversation.id, channelId);
  }
} else if (!justCreated && conversation.triageState === 'pending') {
  conversation = await processTriageReply(conversation, channelId, content);
}
```

Precisa importar `findChannelById` (de `../channels/channel.repository`) e
`enqueueOutboundMessage` (de `../queue/outbound-queue` — mesma função que
`sendTriageQuestion` já usa por baixo, então a boas-vindas passa pela
mesma fila Bull, com o mesmo retry automático e ciclo de vida de mensagem
que qualquer outro envio deste sistema).

A ordem de exibição pro cliente (boas-vindas antes da pergunta de triagem)
vem naturalmente da ordem de `enqueueOutboundMessage` — os dois viram jobs
na mesma fila, processados em sequência pelo worker único.

**Efeito colateral aceito, não corrigido aqui:** uma segunda mensagem
(`enqueueOutboundMessage`) extra por conversa nova quando a boas-vindas
está configurada — mesmo custo/comportamento de qualquer outro envio
automático já existente (triagem), nenhuma proteção nova necessária contra
reenvio duplicado além da que já existe (o guard de `justCreated`, que só
é `true` uma vez por linha de `conversations`).

## Admin (frontend)

### Renomear a aba

`frontend/src/pages/AdminChannelsPage.jsx`: no array `TABS`, o item
`{ value: 'quickReplies', label: 'Respostas rápidas' }` vira
`{ value: 'quickReplies', label: 'Mensagens' }` (o `value` interno não
muda, só o rótulo visível).

### Renomear e expandir o componente da aba

`frontend/src/components/QuickRepliesAdminTab.jsx` vira
`frontend/src/components/MessagesAdminTab.jsx` (o arquivo cresce de escopo
— de "só respostas rápidas" para "mensagens automáticas + respostas
rápidas" — justifica o rename, mesmo padrão de manutenção já seguido
outras vezes nesta sessão quando um arquivo ganha responsabilidade nova).
`AdminChannelsPage.jsx` atualiza o import/uso correspondente.

Novo componente `ChannelWelcomeMessageRow` dentro do mesmo arquivo (mesmo
padrão de `QuickReplyRow`, mas sem modo de edição separado — é só um
`textarea` com estado local e um botão "Salvar" por linha, já que não há
"criar"/"excluir" aqui, só editar o texto de cada canal já existente):

```jsx
function ChannelWelcomeMessageRow({ channel, onSaved }) {
  const { token } = useAuth();
  const [text, setText] = useState(channel.welcomeMessage || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await setChannelWelcomeMessage(channel.id, text, token);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <p className="font-medium text-ink-950">{channel.name}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Sem boas-vindas configurada — deixe em branco para desativar."
        className="mt-2 w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
      />
      {error && <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  );
}
```

`MessagesAdminTab` (a função principal do arquivo) ganha uma seção nova
antes da lista de respostas rápidas já existente:

```jsx
function MessagesAdminTab() {
  const { quickReplies, refresh } = useQuickReplies();
  const { channels, refresh: refreshChannels } = useChannels(true);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">Boas-vindas por canal</h2>
        <p className="text-sm text-ink-950/55">
          Enviada automaticamente sempre que uma conversa nova começa nesse canal.
        </p>
        {channels.map((channel) => (
          <ChannelWelcomeMessageRow key={channel.id} channel={channel} onSaved={refreshChannels} />
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink-950">Respostas rápidas</h2>
        {quickReplies.map((quickReply) => (
          <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
        ))}
        <CreateQuickReplyForm onCreated={refresh} />
      </div>
    </div>
  );
}
```

(`useChannels(true)` — mesma assinatura já usada em `AdminChannelsPage`
para trazer todos os canais visíveis; `QuickReplyRow`/`CreateQuickReplyForm`
continuam exatamente como já existem, só realocados dentro do arquivo
renomeado.)

### `frontend/src/services/api.js`

Nova função, mesmo padrão de `setChannelWabaId`:

```js
export function setChannelWelcomeMessage(id, welcomeMessage, token) {
  return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { welcomeMessage }, token });
}
```

## Erros e casos de borda

- Canal sem boas-vindas configurada (`welcomeMessage: null`): nenhuma
  mudança de comportamento — exatamente como hoje.
- `welcomeMessage` só com espaços em branco: tratado como vazio
  (`.trim() || null`), mesma regra de desativar.
- Conversa reaberta depois de fechada (mesmo contato, mesmo canal): conta
  como conversa nova (`justCreated = true`), recebe a boas-vindas de novo
  — comportamento já confirmado no brainstorm.
- Réplica de uma pergunta de triagem (`!justCreated && triageState ===
  'pending'`): nunca reenvia a boas-vindas — só o ramo `justCreated` dispara
  boas-vindas.
- Falha ao enviar a boas-vindas (canal desconectado, etc.): mesmo
  comportamento de qualquer outro envio — o job na fila Bull tenta de
  novo automaticamente (`attempts: 3`, backoff exponencial), sem lógica
  nova aqui.

## Testes

- `channel.repository.test.js`: `toChannel` inclui `welcomeMessage`;
  `updateChannelWelcomeMessage` (define, limpa com `null`, 404 pra canal
  inexistente); as funções de leitura (`findChannelById`, `listChannels`
  etc.) retornam `welcomeMessage` corretamente.
- `admin-channels.routes.test.js`: `PATCH /:id` com `welcomeMessage`
  (sucesso, string vazia vira `null`, 400 se não for string, 404 se canal
  não existe); 400 quando nenhum dos 4 campos é passado (mensagem de erro
  atualizada).
- `inbound-message.service.test.js`: conversa nova com canal tendo
  `welcomeMessage` → `enqueueOutboundMessage` chamado com o texto certo;
  canal sem `welcomeMessage` → não chamado; canal com boas-vindas E
  triagem → boas-vindas enfileirada antes de `sendTriageQuestion`; réplica
  de triagem (`!justCreated`) → boas-vindas nunca disparada mesmo se o
  canal tiver uma configurada.
- Frontend: `MessagesAdminTab.test.jsx` (renomeado de
  `QuickRepliesAdminTab.test.jsx`, mantendo os testes de respostas
  rápidas já existentes) ganha casos novos — lista um card por canal,
  salvar chama `setChannelWelcomeMessage`, campo vazio desativa.
  `AdminChannelsPage.test.jsx` atualiza a asserção do rótulo da aba de
  "Respostas rápidas" para "Mensagens".

## Migração

Uma migration nova: `ALTER TABLE channels ADD COLUMN welcome_message
TEXT;` (nullable, sem default — equivalente a `NULL`, que já é o estado
"desativado"). **Rodar `npm run migrate -- up` no Render Shell logo após o
deploy**, mesmo lembrete de sempre.

## Fora de escopo

- Mensagem de encerramento por canal e aviso condicional por cidade —
  specs futuras separadas, mencionadas aqui só como contexto.
- Variáveis no texto (nome do cliente etc.) — decisão explícita de deixar
  fixo por enquanto.
- Qualquer alteração no comportamento da triagem em si — só a ordem
  relativa (boas-vindas antes) muda; a lógica de `sendTriageQuestion`/
  `processTriageReply` continua exatamente como está.
