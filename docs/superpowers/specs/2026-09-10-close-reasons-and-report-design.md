# Motivos de contato ao encerrar atendimento + renomear Métricas para Relatório

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-10

## 1. Problema e objetivo

Hoje, ao clicar em "Fechar atendimento" (`ConversationView.jsx`), a conversa é encerrada
na hora, sem registrar por que o cliente entrou em contato. O usuário quer:

1. Um cadastro admin de **motivos de contato** (texto livre criado pelo admin, ex:
   "Troca de senha", "Pagamento - sem conexão").
2. Ao encerrar um atendimento, um popup **obrigatório** pergunta qual foi o motivo —
   escolhe **um** entre os cadastrados, e só depois disso o atendimento realmente
   fecha.
3. Essa informação aparece na página hoje chamada **"Métricas"**, que passa a se
   chamar **"Relatório"**.

## 2. Escopo confirmado com o usuário

- Cadastro de motivos: aba nova em Administração (não dentro de Mensagens nem de
  Setores) — motivo categoriza o atendimento pro relatório, não é uma mensagem.
- Motivo é **obrigatório** pra fechar — sem opção de pular.
- **Um** motivo por atendimento, não vários.
- "Relatório" é só o texto visível (label na barra lateral, `<h1>` da página) — a rota
  `/metrics`, o arquivo `MetricsPage.jsx` e o valor interno `active="metrics"` do
  `NavRail` continuam iguais, pra não mexer em nada por baixo sem necessidade.
- Motivo nunca é excluído, só desativado — porque fica referenciado no histórico de
  atendimentos já fechados; desativar remove só das opções de um encerramento novo.

## 3. Modelo de dados

Migração nova (idempotente, `IF NOT EXISTS`/`IF EXISTS` em tudo, mesmo padrão já
estabelecido nesta sessão):

```sql
CREATE TABLE IF NOT EXISTS contact_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversation_events ADD COLUMN IF NOT EXISTS reason_id UUID REFERENCES contact_reasons(id);
```

`reason_id` só é preenchido na linha do evento `'closed'` — as demais (`assigned`,
`transferred`, `reopened`) continuam com `NULL`. Fica na tabela de eventos, não numa
coluna em `conversations`, porque um atendimento pode ser reaberto e fechado de novo
(`event_type` já inclui `'reopened'`) — cada fechamento é uma linha própria, com seu
próprio motivo, preservando o histórico completo em vez de um único valor que seria
sobrescrito.

`reason_id` referencia `contact_reasons(id)` sem `ON DELETE` especial — como a UI nunca
exclui um motivo (só desativa via `active = false`), a linha nunca é removida, então a
FK nunca precisa lidar com exclusão.

## 4. Backend — repositório de motivos

Novo módulo `src/reasons/reason.repository.js`, mesmo padrão de
`src/sectors/sector.repository.js`:

```js
const { getPool } = require('../db/pool');

function toReason(row) {
  return { id: row.id, name: row.name, active: row.active, createdAt: row.created_at };
}

async function listActiveReasons() {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons WHERE active = true ORDER BY name ASC'
  );
  return result.rows.map(toReason);
}

async function listAllReasons() {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons ORDER BY name ASC'
  );
  return result.rows.map(toReason);
}

async function findReasonById(id) {
  const result = await getPool().query(
    'SELECT id, name, active, created_at FROM contact_reasons WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toReason(result.rows[0]);
}

async function createReason({ name }) {
  const result = await getPool().query(
    'INSERT INTO contact_reasons (name) VALUES ($1) RETURNING id, name, active, created_at',
    [name]
  );
  return toReason(result.rows[0]);
}

async function updateReason(id, { name, active }) {
  const result = await getPool().query(
    `UPDATE contact_reasons SET name = COALESCE($2, name), active = COALESCE($3, active), updated_at = now()
     WHERE id = $1 RETURNING id, name, active, created_at`,
    [id, name !== undefined ? name : null, active !== undefined ? active : null]
  );
  if (result.rowCount === 0) return null;
  return toReason(result.rows[0]);
}

module.exports = { listActiveReasons, listAllReasons, findReasonById, createReason, updateReason };
```

`updateReason` usa `COALESCE` pra atualizar só os campos enviados (`name` e/ou
`active`), independente um do outro — mais simples que o padrão de
`admin-channels.routes.js` (que chama uma função de repositório diferente por campo),
apropriado aqui porque os dois campos deste recurso são realmente independentes e não
têm validação cruzada entre si.

## 5. Backend — rotas

Duas rotas, mesmo padrão de separação já usado por Setores
(`src/api/sectors.routes.js` vs `src/api/admin-sectors.routes.js`):

**`src/api/reasons.routes.js`** (mount `/api/reasons`, qualquer atendente autenticado —
usado pelo popup de encerramento):
```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listActiveReasons } = require('../reasons/reason.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const reasons = await listActiveReasons();
  res.json(reasons);
});

module.exports = router;
```

**`src/api/admin-reasons.routes.js`** (mount `/api/admin/reasons`, só admin — usado pela
tela de cadastro):
```js
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listAllReasons, createReason, updateReason } = require('../reasons/reason.repository');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const reasons = await listAllReasons();
  res.json(reasons);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const reason = await createReason({ name });
  res.status(201).json(reason);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName, active } = req.body || {};
  if (rawName === undefined && active === undefined) {
    return res.status(400).json({ error: 'name or active is required' });
  }
  let name;
  if (rawName !== undefined) {
    name = (rawName || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
  }
  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  const reason = await updateReason(req.params.id, { name, active });
  if (!reason) {
    return res.status(404).json({ error: 'Reason not found' });
  }
  res.json(reason);
});

module.exports = router;
```

Ambas montadas em `src/server.js` junto com as outras (`app.use('/api/reasons',
reasonsRoutes)`, `app.use('/api/admin/reasons', adminReasonsRoutes)`).

## 6. Backend — encerrar atendimento com motivo

**`src/conversations/conversation.repository.js`** — `closeConversation` ganha um
terceiro parâmetro `reasonId`, gravado junto com o evento `'closed'`:

```js
async function closeConversation(conversationId, agentId, reasonId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND (assigned_agent_id = $2 OR assigned_agent_id IS NULL) AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, protocol_number, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, reason_id) VALUES ($1, 'closed', $2, $3)`,
      [conversationId, agentId, reasonId]
    );
    return toConversation(result.rows[0]);
  });
}
```

Nenhuma outra função deste arquivo muda (mesma disciplina de escopo mínimo já usada na
feature "Atribuir um atendimento").

**`src/api/conversations.routes.js`** — `POST /:id/close` passa a exigir `reasonId` no
corpo, validando que existe e está ativo **antes** de chamar `closeConversation` (evita
que uma chamada direta à API, sem passar pelo popup do frontend, feche um atendimento
com um motivo inválido ou já desativado):

```js
router.post('/:id/close', async (req, res) => {
  const { reasonId } = req.body || {};
  if (!reasonId) {
    return res.status(400).json({ error: 'reasonId is required' });
  }
  const reason = await findReasonById(reasonId);
  if (!reason || !reason.active) {
    return res.status(400).json({ error: 'Invalid or inactive reasonId' });
  }
  const conversation = await closeConversation(req.params.id, req.agent.agentId, reasonId);
  if (!conversation) {
    return res.status(409).json({ error: 'Conversation is not currently assigned to you, or is closed' });
  }
  // ... resto do handler não muda (assignment-message close dispatch, broadcasts, etc.)
});
```

Importa `findReasonById` de `../reasons/reason.repository` no topo do arquivo. O resto
do handler (disparo da mensagem de encerramento da feature "Atribuir um atendimento",
`emitToAgent`/`broadcast`, `res.json`) continua exatamente como está.

## 7. Frontend — popup de motivo ao encerrar

**`frontend/src/services/api.js`** — `closeConversation` ganha o parâmetro `reasonId`:
```js
export function closeConversation(conversationId, reasonId, token) {
  return apiFetch(`/api/conversations/${conversationId}/close`, { method: 'POST', body: { reasonId }, token });
}
```
(Todo chamador existente precisa ser atualizado — hoje só `ConversationView.jsx` chama
essa função.) Mais duas funções novas, mesmo padrão de `listSectors`/`createSector`/
`updateSector`:
```js
export function listReasons(token) {
  return apiFetch('/api/reasons', { token });
}

export function listReasonsAdmin(token) {
  return apiFetch('/api/admin/reasons', { token });
}

export function createReason(payload, token) {
  return apiFetch('/api/admin/reasons', { method: 'POST', body: payload, token });
}

export function updateReason(id, payload, token) {
  return apiFetch(`/api/admin/reasons/${id}`, { method: 'PATCH', body: payload, token });
}
```

**`frontend/src/hooks/useReasons.js`** (motivos ativos, usado pelo popup) e
**`frontend/src/hooks/useReasonsAdmin.js`** (todos, usado pela tela admin) — mesmo par
já existente pra atendentes (`useAgents.js`/`useAgentsAdmin.js`), cada um espelhando o
padrão de `useSectors.js` (`{ reasons, loading, refresh }`).

**`frontend/src/components/CloseReasonModal.jsx`** (novo) — usa `WaDialog` (mesmo
componente/estilo WhatsApp já usado dentro de `ConversationView`, não o
`WaDialog`/glass-card do admin), lista de motivos ativos como seleção única
(`<input type="radio">`), botão "Confirmar encerramento" desabilitado até escolher um:

```jsx
import { useState } from 'react';
import WaDialog, { waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';
import { useReasons } from '../hooks/useReasons';

function CloseReasonModal({ onConfirm, onClose }) {
  const { reasons } = useReasons();
  const [reasonId, setReasonId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!reasonId) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(reasonId);
    } catch (err) {
      setError((err.body && err.body.error) || 'Não foi possível encerrar este atendimento.');
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Motivo do contato" description="Escolha o motivo antes de encerrar o atendimento." onClose={onClose}>
      <div className="space-y-2 px-6 py-4">
        {reasons.map((reason) => (
          <label key={reason.id} className="flex items-center gap-2 text-[14.5px] text-wa-text">
            <input
              type="radio"
              name="close-reason"
              checked={reasonId === reason.id}
              onChange={() => setReasonId(reason.id)}
              className="h-4 w-4 accent-wa-green"
            />
            {reason.name}
          </label>
        ))}
        {error && <p className={waErrorClass}>{error}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
        <button type="button" onClick={onClose} className={waGhostButtonClass}>
          Cancelar
        </button>
        <button type="button" onClick={handleConfirm} disabled={!reasonId || submitting} className={waPrimaryButtonClass}>
          Confirmar encerramento
        </button>
      </div>
    </WaDialog>
  );
}

export default CloseReasonModal;
```

**`frontend/src/components/ConversationView.jsx`** — o botão "Fechar atendimento"
(linha ~200, `HeaderIconButton label="Fechar atendimento" onClick={handleClose}`) passa
a abrir o popup em vez de fechar direto:

```jsx
const [closingReason, setClosingReason] = useState(false);

async function handleConfirmClose(reasonId) {
  await closeConversation(conversation.id, reasonId, token);
  setClosingReason(false);
}
```
- `onClick={handleClose}` vira `onClick={() => setClosingReason(true)}`.
- A função `handleClose` antiga (que chamava `closeConversation(conversation.id,
  token)` direto com `window.alert` no catch) é substituída por `handleConfirmClose`
  acima — o `try/catch`/`window.alert` sai daqui porque agora quem trata o erro é o
  próprio `CloseReasonModal` (mostra a mensagem inline, sem `window.alert`, consistente
  com o resto da UI do WhatsApp que já evita `alert()` nativo onde dá).
- Renderiza `{closingReason && <CloseReasonModal onConfirm={handleConfirmClose}
  onClose={() => setClosingReason(false)} />}` junto dos outros popups já existentes
  (`ConversationHistoryModal`, etc.).

## 8. Frontend — cadastro admin de Motivos

Nova aba "Motivos" em `AdminChannelsPage.jsx` (`TABS`), mesmo padrão visual de
`SectorsAdminTab.jsx` (lista sempre visível + formulário de criar sempre visível
abaixo — sem esconder atrás de botão, por ser tipicamente uma lista curta):

**`frontend/src/components/ReasonsAdminTab.jsx`** (novo) — `ReasonRow` com nome,
Editar (mesmo padrão de `SectorRow`) e um toggle "Ativo"/"Inativo" no lugar do botão
Excluir (chama `updateReason(reason.id, { active: !reason.active }, token)`).
`CreateReasonForm` idêntico a `CreateSectorForm.jsx`, trocando `createSector`/"setor"
por `createReason`/"motivo".

## 9. Relatório (renomeado de Métricas)

**`frontend/src/components/NavRail.jsx`** — `label="Métricas"` vira `label="Relatório"`
na `RailLink to="/metrics"` (linha ~70). `to`, `active="metrics"` (usado tanto aqui
quanto em `MetricsPage.jsx`) e o nome do arquivo continuam iguais.

**`frontend/src/pages/MetricsPage.jsx`** — `<h1>Métricas</h1>` vira `<h1>Relatório</h1>`.
Nome do arquivo, rota, componente e todo o resto do código continuam iguais.

Novo gráfico "Atendimentos por motivo", mesmo padrão de "Atendimentos por setor"
(`ChartCard` com `BarChart` do Recharts), dentro do bloco `data.scope === 'admin'`
(só visível pra admin, igual aos outros dois gráficos):

```jsx
<ChartCard title="Atendimentos por motivo" icon={<IconTag className="h-4 w-4" />}>
  {data.byReason.length === 0 ? (
    <EmptyState />
  ) : (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data.byReason} barCategoryGap="32%">
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="reasonName" tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(217, 134, 31, 0.08)' }} />
        <Bar dataKey="closedCount" name="Atendimentos" fill={AMBER_DARK} radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  )}
</ChartCard>
```
Precisa de um ícone novo `IconTag` (mesmo padrão SVG dos outros ícones já definidos no
topo do arquivo — `stroke="currentColor"`, `strokeWidth="1.75"`).

**`src/metrics/metrics.repository.js`** — nova função `getMetricsByReason(since)`,
mesmo padrão de `getMetricsBySector`, mas ordenada por frequência (não por nome — faz
mais sentido pra um relatório de "por que os clientes entram em contato" ver o motivo
mais comum primeiro):

```js
async function getMetricsByReason(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.reason_id
       FROM conversation_events ce
       WHERE ce.event_type = 'closed' AND ce.reason_id IS NOT NULL AND ce.created_at >= $1
     )
     SELECT r.id AS reason_id, r.name AS reason_name, COUNT(*)::int AS closed_count
     FROM closed
     JOIN contact_reasons r ON r.id = closed.reason_id
     GROUP BY r.id, r.name
     ORDER BY closed_count DESC`,
    [since]
  );
  return result.rows.map((row) => ({
    reasonId: row.reason_id,
    reasonName: row.reason_name,
    closedCount: Number(row.closed_count),
  }));
}
```
`ce.reason_id IS NOT NULL` no `WHERE` é defensivo: qualquer atendimento fechado antes
desta feature existir tem `reason_id = NULL` (coluna adicionada depois, sem valor
retroativo) e não deve aparecer no agrupamento.

**`src/api/metrics.routes.js`** — o bloco `role === 'admin'` ganha `getMetricsByReason`
no `Promise.all`, retornando `byReason` junto com `byAgent`/`bySector`.

## 10. Testes

Backend (Jest + `supertest`/integração real-Postgres, seguindo os padrões já
estabelecidos nesta sessão):

- `reason.repository.test.js` — integração real (TRUNCATE), CRUD completo, `active`
  default `true`, `listActiveReasons` filtra corretamente, `updateReason` atualiza só
  o campo passado (name sozinho, active sozinho, os dois).
- `reasons.routes.test.js` / `admin-reasons.routes.test.js` — mocks de repositório,
  validação de campos, 403 pra rota admin sem role.
- `conversation.repository.test.js` — `closeConversation` grava `reason_id` no evento
  `'closed'`.
- `conversations.routes.test.js` — `/close` exige `reasonId`, rejeita motivo
  inexistente/inativo com 400, aceita motivo válido e ativo.
- `metrics.repository.test.js` — `getMetricsByReason` agrupa e ordena por frequência,
  ignora eventos com `reason_id` nulo.

Frontend (Vitest + Testing Library):

- `useReasons.test.js` / `useReasonsAdmin.test.js` — mirror de `useSectors.test.jsx`.
- `ReasonsAdminTab.test.jsx` — CRUD completo, toggle ativo/inativo.
- `CloseReasonModal.test.jsx` — botão de confirmar desabilitado sem seleção, habilita
  ao escolher, chama `onConfirm` com o id certo, mostra erro inline em caso de falha.
- `ConversationView.test.jsx` (arquivo existente) — os testes que hoje chamam
  `closeConversation` direto (`'clicking Fechar calls closeConversation'` etc.) mudam
  pra: clicar em Fechar abre o popup, escolher um motivo, clicar em confirmar, só aí
  `closeConversation` é chamado — agora com `(conversationId, reasonId, token)`.
- `MetricsPage.test.jsx` (se existir) / `NavRail.test.jsx` (arquivo existente) — label
  "Relatório" no lugar de "Métricas".
- Checar `AdminChannelsPage.test.jsx` — padrão recorrente já documentado nesta sessão
  (`project_admin_ui_declutter.md`): esse arquivo pode precisar de um ajuste mínimo pra
  cobrir a aba nova "Motivos".

## 11. Fora de escopo (YAGNI)

- Múltiplos motivos por atendimento — usuário confirmou um só.
- Filtro por período/motivo cruzado na página de Relatório além do gráfico simples —
  não pedido.
- Renomear a rota `/metrics` ou o arquivo `MetricsPage.jsx` — só o texto visível muda,
  confirmado com o usuário.
- Exclusão física de motivo — só desativação, confirmado com o usuário.
