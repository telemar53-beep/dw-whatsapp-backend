# Modo noturno com IA — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fora da janela noturna configurada, a triagem com IA atende sozinha: entrega boleto/PIX, lê comprovante com visão, faz o desbloqueio em confiança quando a regra da casa permite, orienta conexão e deixa na fila da manhã o que precisa de gente, com resumo.

**Architecture:** É a triagem existente (`perfil: 'triagem'`) com um perfil noturno calculado por turno no worker (`triagem.noturno = { ativo, retornoAs }`). O perfil acrescenta duas ferramentas à lista fixa (`desbloqueio_confianca`, `analisar_comprovante`), um bloco de prompt, dois de limite de perguntas e frases de desfecho com a hora de retorno. As garantias de sequência (aviso → execução → "prontinho" → fila) são de código, no padrão das guardas já existentes em `runAiTurn`.

**Tech Stack:** Node 22 / Express 5 / PostgreSQL (node-pg-migrate) / Bull / Jest (banco de teste real); React 18 + Vite + Vitest; OpenAI chat completions (texto e visão).

**Spec:** `docs/superpowers/specs/2026-09-13-ai-night-mode-design.md`

## Global Constraints

- O projeto ENUMERA colunas em SQL (nada de `SELECT *` em `channels`, `conversations`, `messages`, `contacts`): coluna nova precisa chegar em TODAS as consultas e no mapper. `ai_config` e `sgp_query_config` usam `SELECT *`.
- Janela noturna: `ai_config.night_start_time`/`night_end_time` (TIME, nulos = nunca ativa), todos os dias, fuso `America/Sao_Paulo`, atravessa a meia-noite. Hora de retorno ao cliente = `nightEndTime`, formato `HH:MM`.
- Modo noturno ativo = `channel.aiEnabled && channel.aiTriageEnabled && channel.aiNightModeEnabled && janela válida && agora dentro da janela`. Calculado POR TURNO.
- `desbloqueio_confianca` e `analisar_comprovante` existem para o modelo SÓ com o noturno ativo. De dia a lista fixa da triagem não muda.
- A imagem do comprovante: só `image/jpeg`, `image/png`, `image/webp`, até 5 MB, última imagem inbound da conversa nas últimas 24 h, escolhida pelo servidor. Caminho de arquivo nunca aparece em retorno de ferramenta, log ou auditoria.
- Conferência do comprovante em código: `ehComprovante && confianca >= 0.6`; favorecido contém "DW" ou `pixMerchantName` (sem acento/caixa); data nos últimos 7 dias (fuso SP); valor igual a fatura em aberto (tolerância 0.05).
- Frases do dono (seção 6.3 da spec) verbatim, com `{Nome}` e `{retornoAs}` substituídos.
- Nunca logar CPF, código PIX, valor de fatura nem texto bruto da visão; erros via `mensagemSegura`.
- Comentários e commits em português; commits terminam com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Testes: `npm test -- <arquivo>`; suíte inteira `npm test` (roda a migração de teste sozinha; banco em Docker `dw-whatsapp-postgres`/`dw-whatsapp-redis`, `docker start` se parados, NUNCA criar containers). Frontend: `cd frontend && npx vitest run <arquivo>`.

---

### Task 1: Flag do canal, janela noturna na configuração, gate e supressão da auto-resposta

**Files:**
- Create: `migrations/1789060000000_add-ai-night-mode.js`
- Create: `src/ai/night-mode.js`, `src/ai/night-mode.test.js`
- Modify: `src/channels/channel.repository.js` (todas as 15 listas de colunas com `ai_triage_enabled`; mapper; nova `updateChannelAiNightModeEnabled`)
- Modify: `src/api/admin-channels.routes.js:57,117-215` (campo `aiNightModeEnabled`, cascatas)
- Modify: `src/ai/ai-config.repository.js:14-24,65-80` (`nightStartTime`, `nightEndTime`)
- Modify: `src/api/admin-ai.routes.js` (`toConfigResponse`, `PUT /triage`)
- Modify: `src/ai/ai.service.js` (nova `isNightModeActiveForChannel`)
- Modify: `src/conversations/inbound-message.service.js:162`
- Modify: `frontend/src/services/api.js`, `frontend/src/pages/AdminChannelsPage.jsx:132-150,291`, `frontend/src/components/AiTriageConfigCard.jsx`
- Test: `src/channels/channel.repository.test.js`, `src/api/admin-channels.routes.test.js`, `src/ai/ai-config.repository.test.js`, `src/api/admin-ai.routes.test.js`, `src/ai/ai.service.test.js`, `src/conversations/inbound-message.service.test.js`, `frontend/src/pages/AdminChannelsPage.test.jsx`, `frontend/src/components/AiTriageConfigCard.test.jsx`

**Interfaces:**
- Produces: `channel.aiNightModeEnabled: boolean`; `config.nightStartTime: 'HH:MM'|null`, `config.nightEndTime: 'HH:MM'|null`; `dentroDaJanela(agora: Date, inicio: 'HH:MM', fim: 'HH:MM'): boolean`; `isNightModeActive({ channel, config, agora = new Date() }): boolean`; `isNightModeActiveForChannel(channelId): Promise<boolean>`.

- [ ] **Step 1: Migração**

```js
// migrations/1789060000000_add-ai-night-mode.js
// Modo noturno com IA: interruptor por canal e janela (início/fim) na
// configuração da IA. Nulos na janela = noturno nunca ativa.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS ai_night_mode_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS night_start_time TIME NULL,
      ADD COLUMN IF NOT EXISTS night_end_time TIME NULL;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config DROP COLUMN IF EXISTS night_end_time, DROP COLUMN IF EXISTS night_start_time;
    ALTER TABLE channels DROP COLUMN IF EXISTS ai_night_mode_enabled;
  `);
};
```

- [ ] **Step 2: Teste do gate (falhando)**

```js
// src/ai/night-mode.test.js
const { dentroDaJanela, isNightModeActive } = require('./night-mode');

// Instantes em horário de São Paulo (UTC-3).
const as = (hhmm) => new Date(`2026-09-13T${hhmm}:00-03:00`);
const CANAL = { aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: true };
const CONFIG = { nightStartTime: '20:00', nightEndTime: '08:00' };

describe('dentroDaJanela', () => {
  test('janela que atravessa a meia-noite', () => {
    expect(dentroDaJanela(as('20:00'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('23:59'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('00:10'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('07:59'), '20:00', '08:00')).toBe(true);
    expect(dentroDaJanela(as('08:00'), '20:00', '08:00')).toBe(false);
    expect(dentroDaJanela(as('12:00'), '20:00', '08:00')).toBe(false);
    expect(dentroDaJanela(as('19:59'), '20:00', '08:00')).toBe(false);
  });
  test('janela no mesmo dia, e janela vazia nunca ativa', () => {
    expect(dentroDaJanela(as('13:00'), '12:00', '14:00')).toBe(true);
    expect(dentroDaJanela(as('14:00'), '12:00', '14:00')).toBe(false);
    expect(dentroDaJanela(as('13:00'), '13:00', '13:00')).toBe(false);
    expect(dentroDaJanela(as('13:00'), null, '14:00')).toBe(false);
  });
  test('usa o fuso de São Paulo, não o do servidor', () => {
    // 02:30 UTC = 23:30 em São Paulo (dentro de 20:00–08:00).
    expect(dentroDaJanela(new Date('2026-09-14T02:30:00Z'), '20:00', '08:00')).toBe(true);
  });
});

describe('isNightModeActive', () => {
  test('exige as três flags do canal, a janela configurada e a hora dentro dela', () => {
    expect(isNightModeActive({ channel: CANAL, config: CONFIG, agora: as('22:00') })).toBe(true);
    expect(isNightModeActive({ channel: { ...CANAL, aiNightModeEnabled: false }, config: CONFIG, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: { ...CANAL, aiTriageEnabled: false }, config: CONFIG, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: { ...CANAL, aiEnabled: false }, config: CONFIG, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: CANAL, config: { nightStartTime: null, nightEndTime: null }, agora: as('22:00') })).toBe(false);
    expect(isNightModeActive({ channel: CANAL, config: CONFIG, agora: as('10:00') })).toBe(false);
    expect(isNightModeActive({ channel: null, config: CONFIG, agora: as('22:00') })).toBe(false);
  });
});
```

Run: `npm test -- src/ai/night-mode.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Gate**

```js
// src/ai/night-mode.js
// Modo noturno com IA: fora da janela configurada (todos os dias, feriado
// incluído, atravessando a meia-noite), a triagem atende sozinha. Calculado
// por turno, nunca por conversa — uma conversa que começa 19:55 vira noturna
// no turno das 20:10.
const FUSO = 'America/Sao_Paulo';

function minutosEmSaoPaulo(agora) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(agora);
  const hora = Number(partes.find((p) => p.type === 'hour').value) % 24;
  const minuto = Number(partes.find((p) => p.type === 'minute').value);
  return hora * 60 + minuto;
}

function minutosDe(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dentroDaJanela(agora, inicio, fim) {
  const i = minutosDe(inicio);
  const f = minutosDe(fim);
  if (i == null || f == null || i === f) return false;
  const n = minutosEmSaoPaulo(agora);
  return i < f ? n >= i && n < f : n >= i || n < f;
}

function isNightModeActive({ channel, config, agora = new Date() }) {
  if (!channel || !channel.aiEnabled || !channel.aiTriageEnabled || !channel.aiNightModeEnabled) return false;
  if (!config) return false;
  return dentroDaJanela(agora, config.nightStartTime, config.nightEndTime);
}

module.exports = { dentroDaJanela, isNightModeActive, minutosDe };
```

Run: `npm test -- src/ai/night-mode.test.js` → PASS. Commit: `git commit -m "Modo noturno: migração e gate da janela"`.

- [ ] **Step 4: Repositório do canal**

Em `src/channels/channel.repository.js`: acrescente `ai_night_mode_enabled` em TODAS as listas de colunas que hoje têm `ai_triage_enabled` (`grep -c ai_triage_enabled` deve ficar igual a `grep -c ai_night_mode_enabled`), `aiNightModeEnabled: row.ai_night_mode_enabled` no `toChannel`, e:

```js
async function updateChannelAiNightModeEnabled(id, enabled) {
  const result = await getPool().query(
    `UPDATE channels SET ai_night_mode_enabled = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, ai_enabled, ai_triage_enabled, ai_night_mode_enabled, created_at`,
    [id, enabled]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}
```
(exporte). Teste em `channel.repository.test.js`, ao lado do teste de `updateChannelAiTriageEnabled`: cria canal, `aiNightModeEnabled` sai `false`, liga → `true`, `findChannelById` devolve `true`.

- [ ] **Step 5: Rota do canal**

Em `src/api/admin-channels.routes.js`: `toChannelResponse` inclui `aiNightModeEnabled: channel.aiNightModeEnabled`; o PATCH aceita `aiNightModeEnabled` (boolean; mensagem de "is required" lista o campo novo); regras:
- `aiEnabled === false` → além de zerar a triagem, `updateChannelAiNightModeEnabled(id, false)`;
- `aiTriageEnabled === false` → `updateChannelAiNightModeEnabled(id, false)`;
- `aiNightModeEnabled === true` exige `existing.aiEnabled && existing.aiTriageEnabled` → senão 400 `'aiNightModeEnabled requires aiTriageEnabled'`.
Testes em `admin-channels.routes.test.js` no padrão dos de `aiTriageEnabled`: liga com triagem ligada (200), recusa sem triagem (400), desligar a triagem desliga o noturno, desligar a IA desliga os dois.

- [ ] **Step 6: Configuração da janela**

`src/ai/ai-config.repository.js`: mapper ganha `nightStartTime: row.night_start_time ? String(row.night_start_time).slice(0, 5) : null` e `nightEndTime` idem; `updateTriageConfig({ ..., nightStartTime, nightEndTime })` grava `$6, $7` (`night_start_time = $6, night_end_time = $7`; `undefined` → `null`).
`src/api/admin-ai.routes.js`: `toConfigResponse` inclui os dois; `PUT /triage` aceita `nightStartTime`/`nightEndTime`: cada um `null`/`''`/ausente ou string `HH:MM` (`/^([01]\d|2[0-3]):[0-5]\d$/`) → senão 400 `'nightStartTime and nightEndTime must be HH:MM or empty'`; um preenchido e o outro não → 400 `'nightStartTime and nightEndTime must be provided together'`.
Testes nos dois arquivos de teste correspondentes (repositório com banco real: grava e lê `'20:00'`/`'08:00'` e nulos; rota: 400 para `'8h'`, 400 para só um, 200 com os dois e com nenhum).

- [ ] **Step 7: Gate por canal e supressão da auto-resposta**

`src/ai/ai.service.js`:
```js
const { getAiConfig } = require('./ai-config.repository');
const { isNightModeActive } = require('./night-mode');

// Modo noturno ativo agora, para este canal. Uma consulta ao canal e uma à
// config — quem já tem os dois em mãos deve chamar isNightModeActive direto.
async function isNightModeActiveForChannel(channelId, agora = new Date()) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.aiEnabled || !channel.aiTriageEnabled || !channel.aiNightModeEnabled) return false;
  if (!(await shouldRunAi(channelId))) return false;
  const config = await getAiConfig();
  return isNightModeActive({ channel, config, agora });
}
```
(exporte; `shouldRunAi` já existe no arquivo). `src/conversations/inbound-message.service.js` linha 162:
```js
  // Com o modo noturno ativo no canal, quem fala primeiro é a IA — o aviso
  // de "estamos fora do horário" contradiria a resposta que vem em seguida.
  const noturnoAtivo = outsideBusinessHours ? await isNightModeActiveForChannel(channelId) : false;
  if (outsideBusinessHours && !noturnoAtivo && !conversation.businessHoursNoticeSentAt && !conversation.assignedAgentId) {
```
Testes: `ai.service.test.js` (flags e janela; mocke `findChannelById`, `getAiConfig`, e o que `shouldRunAi` usa); `inbound-message.service.test.js` (mock de `isNightModeActiveForChannel` em `../ai/ai.service`: `true` → não envia o aviso nem marca `businessHoursNoticeSentAt`; `false` → comportamento de hoje).

- [ ] **Step 8: Frontend**

`frontend/src/services/api.js`: `export function setChannelAiNightModeEnabled(id, aiNightModeEnabled, token) { return apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: { aiNightModeEnabled }, token }); }`.
`AdminChannelsPage.jsx`: abaixo do checkbox "Triagem com IA", um checkbox "Atendimento noturno com IA" (`checked={!!channel.aiNightModeEnabled}`, `disabled={!channel.aiTriageEnabled}`, handler `handleToggleAiNightMode` no molde de `handleToggleAiTriage`).
`AiTriageConfigCard.jsx`: dois inputs `type="time"` — `id="triage-night-start"` "Atendimento noturno com IA — início" e `id="triage-night-end"` "— fim" — estados iniciados de `config.nightStartTime || ''`/`config.nightEndTime || ''`; payload `nightStartTime: nightStart || null`, `nightEndTime: nightEnd || null`; validação no cliente: um preenchido sem o outro → `setError('Informe início e fim do atendimento noturno, ou deixe os dois vazios')`; ajuda: "Todos os dias, feriados incluídos. Ex.: 20:00 a 08:00. Cada canal ainda precisa do interruptor \"Atendimento noturno com IA\"."
Testes: `AdminChannelsPage.test.jsx` (checkbox desabilitado sem triagem; clicar chama `setChannelAiNightModeEnabled`), `AiTriageConfigCard.test.jsx` (salva os dois; erro com só um).

- [ ] **Step 9: Suítes e commit**

`npm test` e `cd frontend && npx vitest run` verdes. Commit: `git commit -m "Modo noturno: interruptor do canal, janela na configuração e auto-resposta suprimida"`.

---

### Task 2: Perfil noturno no worker e no prompt

**Files:**
- Modify: `src/queue/ai-worker.js:140-165`
- Modify: `src/ai/ai-orchestrator.js` (`FERRAMENTAS_TRIAGEM`, `montarContextoTriagem`, montagem de `tools` na triagem)
- Modify: `src/ai/tool-registry.js:1006,1053` (instruções de `concluir_triagem` e `encerrar_atendimento`), resumo de `concluir_triagem`
- Test: `src/queue/ai-worker.test.js`, `src/ai/ai-orchestrator.test.js`, `src/ai/tool-registry.test.js`

**Interfaces:**
- Consumes: `isNightModeActive({ channel, config })`, `config.nightEndTime`.
- Produces: `triagem.noturno = { ativo: boolean, retornoAs: 'HH:MM' }` em `runAiTurn` e em `contexto.triagem`; `FERRAMENTAS_TRIAGEM_NOTURNO` (lista fixa da triagem + `'desbloqueio_confianca'`, `'analisar_comprovante'`); `contexto.ferramentasPermitidas` = lista noturna quando ativo; `ferramentasDaTriagem(triagem)` exportada.

- [ ] **Step 1: Teste do worker (falhando)**

Em `ai-worker.test.js`, describe da triagem (mocks já existentes; acrescente `jest.mock('../ai/night-mode')` e importe `isNightModeActive`):
```js
  test('com o modo noturno ativo, passa noturno.ativo, retornoAs e limite +2 ao turno', async () => {
    isNightModeActive.mockReturnValue(true);
    getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'k', model: 'm', triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3, transcriptionFeedAi: true, nightStartTime: '20:00', nightEndTime: '08:00' });
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
      triagem: expect.objectContaining({ maxQuestions: 4, noturno: { ativo: true, retornoAs: '08:00' } }),
    }));
  });

  test('sem modo noturno, noturno.ativo é false e o limite é o configurado', async () => {
    isNightModeActive.mockReturnValue(false);
    await handleAiJob({ conversationId: 'c-1', messageId: 'm-1' });
    expect(runAiTurn).toHaveBeenCalledWith(expect.objectContaining({
      triagem: expect.objectContaining({ maxQuestions: 2, noturno: { ativo: false, retornoAs: null } }),
    }));
  });
```
Run: `npm test -- src/queue/ai-worker.test.js` → FAIL.

- [ ] **Step 2: Worker**

Em `handleTriageTurn` (o `channel` já foi carregado no início da função):
```js
  const noturnoAtivo = isNightModeActive({ channel, config });
  const noturno = { ativo: noturnoAtivo, retornoAs: noturnoAtivo ? config.nightEndTime : null };
  // À noite o roteiro de conexão pede "uma etapa por vez": duas perguntas a
  // mais cabem sem transformar a triagem em atendimento completo.
  const maxQuestions = (Number.isInteger(config.triageMaxQuestions) ? config.triageMaxQuestions : 2) + (noturnoAtivo ? 2 : 0);
  ...
    triagem: { threshold: config.triageConfidenceThreshold, maxQuestions, attempts, forcarConclusao, noturno },
```
Run → PASS. Commit: `git commit -m "Modo noturno: worker calcula o perfil noturno por turno"`.

- [ ] **Step 3: Teste do orquestrador (falhando)**

No describe de triagem de `ai-orchestrator.test.js`:
```js
  describe('perfil noturno', () => {
    const NOTURNO = { ...TRIAGEM, maxQuestions: 4, noturno: { ativo: true, retornoAs: '08:00' } };

    test('à noite a lista fixa ganha desbloqueio_confianca e analisar_comprovante; de dia não', async () => {
      const req = await contexto({ triagem: NOTURNO });
      const nomes = req.tools.map((t) => t.function.name);
      expect(nomes).toEqual(expect.arrayContaining(['desbloqueio_confianca', 'analisar_comprovante']));
      jest.clearAllMocks();
      createChatCompletion.mockResolvedValue({ message: { content: 'Oi' }, usage: {} });
      const dia = await contexto();
      expect(dia.tools.map((t) => t.function.name)).not.toEqual(expect.arrayContaining(['desbloqueio_confianca', 'analisar_comprovante']));
    });

    test('o bloco noturno do prompt cita a hora de retorno e proíbe prometer solução imediata', async () => {
      const sys = (await contexto({ triagem: NOTURNO })).messages[0].content;
      expect(sys).toMatch(/MODO NOTURNO/);
      expect(sys).toMatch(/A equipe volta às 08:00/);
      expect(sys).toMatch(/Nunca prometa solução imediata/);
      expect(sys).toMatch(/nossa equipe dá continuidade a partir das 08:00/);
    });

    test('de dia o prompt não tem o bloco noturno', async () => {
      const sys = (await contexto()).messages[0].content;
      expect(sys).not.toMatch(/MODO NOTURNO/);
    });
  });
```
Run → FAIL.

- [ ] **Step 4: Orquestrador**

```js
// src/ai/ai-orchestrator.js
const FERRAMENTAS_TRIAGEM_NOTURNO = [...FERRAMENTAS_TRIAGEM, 'desbloqueio_confianca', 'analisar_comprovante'];

// A lista fixa da triagem só cresce à noite: descrever ao modelo uma
// capacidade que ele não tem de dia é o jeito conhecido de ele afirmar que fez.
function ferramentasDaTriagem(triagem) {
  return triagem && triagem.noturno && triagem.noturno.ativo ? FERRAMENTAS_TRIAGEM_NOTURNO : FERRAMENTAS_TRIAGEM;
}
```
Onde a triagem monta `tools`/`ferramentasPermitidas` (`toOpenAiTools(FERRAMENTAS_TRIAGEM)` e `ferramentasPermitidas: FERRAMENTAS_TRIAGEM`), use `ferramentasDaTriagem(triagem)`. Exporte `FERRAMENTAS_TRIAGEM_NOTURNO` e `ferramentasDaTriagem`.

Em `montarContextoTriagem(config, identidade, triagem)`, logo após a linha da hora de Brasília, quando `triagem && triagem.noturno && triagem.noturno.ativo`:
```js
    linhas.push(
      '',
      `MODO NOTURNO: estamos fora do horário comercial e NÃO há atendente agora. Você atende sozinha o que as ferramentas permitem e deixa na fila, com resumo, o que precisa de gente. A equipe volta às ${triagem.noturno.retornoAs}. Nunca prometa solução imediata, técnico ou prazo.`,
      `Ao concluir para um setor à noite, diga que "nossa equipe dá continuidade a partir das ${triagem.noturno.retornoAs}" — nunca "um atendente continua daqui".`,
    );
```
E em `concluir_triagem` (tool-registry, linha ~1006) a `instrucao` passa a depender de `contexto.triagem && contexto.triagem.noturno && contexto.triagem.noturno.ativo`:
- noturno: `` `Responda ao cliente em uma frase: use o primeiro nome se souber, diga que o atendimento ficou registrado para o setor ${setor.name} e que nossa equipe dá continuidade a partir das ${retornoAs}. Não faça mais perguntas.` ``
- dia: texto atual.
O resumo de `concluir_triagem` ganha, como PRIMEIRA linha quando noturno: `` `Modo noturno · ${hora}` `` com `hora` = `new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())`.
`encerrar_atendimento` (linha ~1053): à noite a instrução termina com "e, se ele precisar de algo mais, a equipe volta às {retornoAs}".
Testes em `tool-registry.test.js` (describes de `concluir_triagem` e `encerrar_atendimento`): com `ctx({ triagem: { threshold: 0.8, maxQuestions: 4, attempts: 0, noturno: { ativo: true, retornoAs: '08:00' } } })` → `instrucao` contém `a partir das 08:00` e o `summary` começa com `Modo noturno · `; sem noturno → como hoje.

Run: `npm test -- src/ai/ai-orchestrator.test.js src/ai/tool-registry.test.js` → PASS. Commit: `git commit -m "Modo noturno: ferramentas, bloco do prompt e frases de desfecho"`.

---

### Task 3: Visão e a ferramenta `analisar_comprovante`

**Files:**
- Modify: `src/ai/openai-client.js` (nova `analyzeImage`), `src/ai/openai-client.test.js`
- Modify: `src/conversations/message.repository.js` (nova `findLatestInboundImage`), `src/conversations/message.repository.test.js`
- Create: `src/ai/comprovante.js` (conferência pura), `src/ai/comprovante.test.js`
- Modify: `src/ai/tool-registry.js` (ferramenta nova), `src/ai/tool-registry.test.js`

**Interfaces:**
- Produces: `analyzeImage({ apiKey, model, imageBuffer, mimeType, prompt }): Promise<object>` (JSON já parseado); `findLatestInboundImage(conversationId, { withinMs }): Promise<{ id, mediaPath, mediaMimeType, createdAt } | null>`; `conferirComprovante({ leitura, faturas, nomesAceitos, hoje }): { valido, tipo, valor, data, favorecidoConfere, dataConfere, valorConfere, faturaId, motivos }`; ferramenta `analisar_comprovante` → `{ analisado, valido, tipo, valor, data, favorecidoConfere, dataConfere, valorConfere, contratoId, faturaId, motivos }` e `contexto.comprovante`.

- [ ] **Step 1: Cliente de visão (teste falhando)**

```js
// openai-client.test.js
describe('analyzeImage', () => {
  test('manda a imagem como data URL, pede JSON e devolve o objeto parseado', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{"ehComprovante":true,"valor":135}' } }], usage: {} } });
    const r = await analyzeImage({ apiKey: 'sk', model: 'gpt-x', imageBuffer: Buffer.from('img'), mimeType: 'image/png', prompt: 'leia' });
    expect(r).toEqual({ ehComprovante: true, valor: 135 });
    const body = axios.post.mock.calls[0][1];
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from('img').toString('base64')}`);
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'leia' });
  });
  test('resposta que não é JSON vira erro OpenAiRequestError, sem vazar o conteúdo', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'não sei' } }], usage: {} } });
    await expect(analyzeImage({ apiKey: 'sk', model: 'gpt-x', imageBuffer: Buffer.from('x'), mimeType: 'image/png', prompt: 'p' })).rejects.toThrow(/JSON/);
  });
});
```

- [ ] **Step 2: Cliente de visão**

```js
const VISION_TIMEOUT_MS = 60000;
async function analyzeImage({ apiKey, model, imageBuffer, mimeType, prompt }) {
  const body = {
    model,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } },
      ],
    }],
  };
  let response;
  try {
    response = await axios.post(`${BASE_URL}/chat/completions`, body, { headers: headers(apiKey), timeout: VISION_TIMEOUT_MS });
  } catch (err) {
    throw traduzErro(err, '/chat/completions (vision)');
  }
  const content = (((response.data.choices || [])[0] || {}).message || {}).content || '';
  try {
    return JSON.parse(content);
  } catch (err) {
    // O texto bruto não vai para a mensagem de erro: pode conter dados do comprovante.
    throw new OpenAiRequestError('Vision response was not valid JSON');
  }
}
```
(exporte). Run → PASS. Commit.

- [ ] **Step 3: Última imagem inbound (teste com banco real)**

`message.repository.test.js`: cria conversa, mensagens `image` inbound (com `mediaPath: 'a.png', mediaMimeType: 'image/png'`), depois `text`, depois `image` outbound → `findLatestInboundImage(conv.id, { withinMs: 24*3600*1000 })` devolve a inbound `image` (não a outbound, não o texto); com `withinMs: 1` e `created_at` antigo (UPDATE manual) devolve `null`.
```js
async function findLatestInboundImage(conversationId, { withinMs }) {
  const result = await getPool().query(
    `SELECT id, media_path, media_mime_type, created_at FROM messages
      WHERE conversation_id = $1 AND direction = 'inbound' AND message_type = 'image'
        AND created_at > now() - ($2::bigint * interval '1 millisecond')
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId, Math.max(0, Math.floor(withinMs))]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id, mediaPath: row.media_path, mediaMimeType: row.media_mime_type, createdAt: row.created_at };
}
```
Commit.

- [ ] **Step 4: Conferência pura (teste falhando)**

```js
// src/ai/comprovante.test.js
const { conferirComprovante, PROMPT_VISAO } = require('./comprovante');
const HOJE = new Date('2026-09-13T22:00:00-03:00');
const FATURAS = [{ id: '4321', value: 135, dueDate: '2026-09-16' }, { id: '4322', value: 89.9, dueDate: '2026-09-20' }];
const LEITURA = { ehComprovante: true, tipo: 'pix', valor: 135, data: '2026-09-13', favorecido: 'DW TELECOM LTDA', banco: 'Nubank', confianca: 0.92 };

test('comprovante válido: favorecido, data e valor conferem, e acha a fatura', () => {
  const r = conferirComprovante({ leitura: LEITURA, faturas: FATURAS, nomesAceitos: ['DW', 'DW Telecom'], hoje: HOJE });
  expect(r).toMatchObject({ valido: true, favorecidoConfere: true, dataConfere: true, valorConfere: true, faturaId: '4321', tipo: 'pix', valor: 135, data: '2026-09-13', motivos: [] });
});
test('valor com diferença de até 5 centavos confere; acima não', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, valor: 135.04 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).valorConfere).toBe(true);
  const r = conferirComprovante({ leitura: { ...LEITURA, valor: 130 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE });
  expect(r.valido).toBe(false);
  expect(r.motivos).toContain('valor não corresponde a nenhuma fatura em aberto');
});
test('favorecido sem DW nem o nome do recebedor não confere (sem acento/caixa)', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, favorecido: 'Loja do João' }, faturas: FATURAS, nomesAceitos: ['DW', 'Dw Telecom'], hoje: HOJE }).favorecidoConfere).toBe(false);
  expect(conferirComprovante({ leitura: { ...LEITURA, favorecido: 'dw telecom ltda' }, faturas: FATURAS, nomesAceitos: ['DW Telecom'], hoje: HOJE }).favorecidoConfere).toBe(true);
});
test('data velha (8 dias) ou futura não confere; 7 dias atrás confere', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-05' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(false);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-06' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(true);
  expect(conferirComprovante({ leitura: { ...LEITURA, data: '2026-09-14' }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).dataConfere).toBe(false);
});
test('não é comprovante ou confiança baixa: inválido com motivo', () => {
  expect(conferirComprovante({ leitura: { ...LEITURA, ehComprovante: false }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).motivos).toContain('a imagem não parece um comprovante de pagamento');
  expect(conferirComprovante({ leitura: { ...LEITURA, confianca: 0.3 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE }).valido).toBe(false);
});
test('leitura malformada (valor como texto, data em outro formato) não derruba: trata como não conferido', () => {
  const r = conferirComprovante({ leitura: { ehComprovante: true, valor: 'cento e trinta', data: '13/09/2026', favorecido: null, confianca: 0.9 }, faturas: FATURAS, nomesAceitos: ['DW'], hoje: HOJE });
  expect(r.valido).toBe(false);
  expect(r.valorConfere).toBe(false);
  expect(r.dataConfere).toBe(false);
  expect(r.favorecidoConfere).toBe(false);
});
test('o prompt de visão pede só JSON com os campos esperados', () => {
  expect(PROMPT_VISAO).toMatch(/ehComprovante/);
  expect(PROMPT_VISAO).toMatch(/favorecido/);
  expect(PROMPT_VISAO).toMatch(/Responda SOMENTE com JSON/);
});
```

- [ ] **Step 5: Conferência pura**

```js
// src/ai/comprovante.js
// Leitura do comprovante pela visão da OpenAI e conferência EM CÓDIGO. O
// modelo de chat nunca digita valor, data ou favorecido: quem lê é a visão,
// quem confere é este módulo, e o modelo só recebe o veredito.
const PROMPT_VISAO = [
  'Esta imagem deve ser um comprovante de pagamento brasileiro (PIX, boleto ou transferência).',
  'Extraia: ehComprovante (true/false), tipo ("pix" | "boleto" | "transferencia" | "outro"), valor (número em reais, ponto decimal, ex.: 135.00), data (do pagamento, formato AAAA-MM-DD), favorecido (nome de quem recebeu), banco (do pagador, se aparecer), confianca (0 a 1).',
  'Se um campo não estiver legível, use null. Responda SOMENTE com JSON, sem texto fora dele.',
].join(' ');

const TOLERANCIA_VALOR = 0.05;
const JANELA_DIAS = 7;
const CONFIANCA_MINIMA = 0.6;

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function dataEmSaoPaulo(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // AAAA-MM-DD
}

function diasEntre(iso, hoje) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hy, hm, hd] = dataEmSaoPaulo(hoje).split('-').map(Number);
  return Math.round((Date.UTC(hy, hm - 1, hd) - Date.UTC(y, m - 1, d)) / 86400000);
}

function conferirComprovante({ leitura, faturas, nomesAceitos, hoje = new Date() }) {
  const l = leitura && typeof leitura === 'object' ? leitura : {};
  const motivos = [];
  const confianca = Number(l.confianca);
  if (l.ehComprovante !== true) motivos.push('a imagem não parece um comprovante de pagamento');
  else if (!(confianca >= CONFIANCA_MINIMA)) motivos.push('leitura do comprovante com confiança baixa');

  const favorecido = semAcento(l.favorecido);
  const favorecidoConfere = Boolean(favorecido) && (nomesAceitos || []).some((n) => semAcento(n) && favorecido.includes(semAcento(n)));
  if (!favorecidoConfere) motivos.push('favorecido não é a DW');

  const dataOk = typeof l.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.data);
  const dias = dataOk ? diasEntre(l.data, hoje) : null;
  const dataConfere = dataOk && dias >= 0 && dias <= JANELA_DIAS;
  if (!dataConfere) motivos.push('data do pagamento fora dos últimos 7 dias');

  const valor = typeof l.valor === 'number' ? l.valor : Number(String(l.valor || '').replace(',', '.'));
  const fatura = Number.isFinite(valor) ? (faturas || []).find((f) => Math.abs(Number(f.value) - valor) <= TOLERANCIA_VALOR) : null;
  const valorConfere = Boolean(fatura);
  if (!valorConfere) motivos.push('valor não corresponde a nenhuma fatura em aberto');

  return {
    valido: motivos.length === 0,
    tipo: typeof l.tipo === 'string' ? l.tipo : 'outro',
    valor: Number.isFinite(valor) ? valor : null,
    data: dataOk ? l.data : null,
    favorecidoConfere, dataConfere, valorConfere,
    faturaId: fatura ? fatura.id : null,
    motivos,
  };
}

module.exports = { conferirComprovante, PROMPT_VISAO, TOLERANCIA_VALOR, JANELA_DIAS, CONFIANCA_MINIMA };
```
Run → PASS. Commit: `git commit -m "Comprovante: prompt de visão e conferência em código"`.

- [ ] **Step 6: Ferramenta (teste falhando)**

`tool-registry.test.js` — mocks: `../conversations/message.repository` (`findLatestInboundImage`), `../media/media-storage` (`getMediaFilePath`), `fs` (use `jest.spyOn(fs.promises, 'stat')` e `'readFile'`), `./openai-client` (`analyzeImage`), `./ai-config.repository` (`getAiConfig` → `{ apiKey: 'sk', model: 'gpt-x' }`), `../integrations/sgp-client` (`getDuplicateInvoice`, `getPixMerchant`). Contexto: `{ conversationId: 'c-1', contracts: [{ id: 17402, address: 'RUA X' }], identidade: { nivel: 'forte', primeiroNome: 'Ana' }, triagem: { noturno: { ativo: true, retornoAs: '08:00' } } }`.
Casos: (a) fora da triagem → `erro`; (b) de dia (`triagem.noturno.ativo` false) → `{ analisado: false, motivo: 'Leitura de comprovante só no modo noturno.' }`; (c) sem imagem nas 24 h → `{ analisado: false, motivo: 'Nenhuma imagem recebida do cliente nas últimas 24 horas.' }`; (d) MIME `application/pdf` → `analisado: false`, `analyzeImage` não chamado; (e) 6 MB → `analisado: false`; (f) feliz: `analyzeImage` chamado com o buffer e `PROMPT_VISAO`, `getDuplicateInvoice` de todos os contratos, retorno `valido: true`, `contratoId: 17402`, `faturaId`, e `contexto.comprovante` preenchido; o retorno NÃO tem `mediaPath`; (g) `analyzeImage` rejeita → `{ analisado: false, motivo: 'Não foi possível ler a imagem agora.' }`.

- [ ] **Step 7: Ferramenta**

```js
  {
    nome: 'analisar_comprovante',
    categoria: 'CONSULTA',
    // Sem parâmetros de propósito: o modelo NUNCA escolhe qual arquivo ler.
    isentoDeProprietario: true,
    exigeIdentidadeForte: true,
    timeoutMs: 90000,
    descricao: 'Lê o último comprovante de pagamento (imagem) que o cliente enviou nesta conversa e confere valor, data e favorecido contra as faturas em aberto. Só no modo noturno. Use antes de qualquer desbloqueio em confiança motivado por comprovante.',
    parametros: { type: 'object', properties: {} },
    validar() { return { ok: true, args: {} }; },
    async executar(args, contexto) {
      if (!perfilTriagem(contexto)) return erro('analisar_comprovante is only available during AI triage');
      const noturno = contexto.triagem && contexto.triagem.noturno && contexto.triagem.noturno.ativo;
      if (!noturno) return { analisado: false, motivo: 'Leitura de comprovante só no modo noturno.' };

      const imagem = await findLatestInboundImage(contexto.conversationId, { withinMs: 24 * 60 * 60 * 1000 });
      if (!imagem) return { analisado: false, motivo: 'Nenhuma imagem recebida do cliente nas últimas 24 horas.' };
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(imagem.mediaMimeType)) {
        return { analisado: false, motivo: 'A última imagem não está num formato que dá para ler (use JPG, PNG ou WEBP).' };
      }
      let buffer;
      try {
        const caminho = getMediaFilePath(imagem.mediaPath);
        const info = await fs.promises.stat(caminho);
        if (info.size > 5 * 1024 * 1024) return { analisado: false, motivo: 'A imagem é grande demais para ler (limite 5 MB).' };
        buffer = await fs.promises.readFile(caminho);
      } catch (err) {
        console.error(`analisar_comprovante: arquivo indisponível na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
        return { analisado: false, motivo: 'Não foi possível abrir a imagem.' };
      }

      const config = await getAiConfig();
      let leitura;
      try {
        leitura = await analyzeImage({ apiKey: config.apiKey, model: config.model, imageBuffer: buffer, mimeType: imagem.mediaMimeType, prompt: PROMPT_VISAO });
      } catch (err) {
        console.error(`analisar_comprovante: visão falhou na conversa ${contexto.conversationId}: ${mensagemSegura(err)}`);
        return { analisado: false, motivo: 'Não foi possível ler a imagem agora.' };
      }

      // Faturas em aberto de TODOS os contratos: o comprovante pode ser do outro ponto.
      const contratos = contexto.contracts || [];
      const segundasVias = await Promise.allSettled(contratos.map((c) => sgpClient.getDuplicateInvoice(c.id)));
      const faturas = [];
      segundasVias.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value && r.value.hasOpenInvoice) {
          for (const d of r.value.duplicates) faturas.push({ id: d.id, value: d.value, dueDate: d.dueDate, contratoId: contratos[i].id });
        }
      });
      const merchant = await sgpClient.getPixMerchant();
      const nomesAceitos = ['DW', ...(merchant && merchant.name ? [merchant.name] : [])];
      const conferencia = conferirComprovante({ leitura, faturas, nomesAceitos });
      const fatura = conferencia.faturaId ? faturas.find((f) => f.id === conferencia.faturaId) : null;
      const resultado = { analisado: true, ...conferencia, contratoId: fatura ? fatura.contratoId : null };
      contexto.comprovante = { valido: conferencia.valido, contratoId: resultado.contratoId, faturaId: conferencia.faturaId, valor: conferencia.valor, data: conferencia.data, tipo: conferencia.tipo, motivos: conferencia.motivos };
      return resultado;
    },
  },
```
Imports novos no topo de `tool-registry.js`: `fs`, `findLatestInboundImage` (message.repository), `getMediaFilePath` (media-storage), `analyzeImage` (openai-client), `conferirComprovante, PROMPT_VISAO` (./comprovante). Run → PASS. Commit: `git commit -m "Ferramenta analisar_comprovante: visão + conferência, só no modo noturno"`.

---

### Task 4: Desbloqueio à noite com as garantias de sequência

**Files:**
- Modify: `src/ai/tool-registry.js:657-760` (`desbloqueio_confianca`), resumo de `concluir_triagem`
- Modify: `src/ai/ai-orchestrator.js` (verificador de afirmações: liberação e fila), prompt do comprovante
- Test: `src/ai/tool-registry.test.js`, `src/ai/ai-orchestrator.test.js`

**Interfaces:**
- Consumes: `contexto.triagem.noturno`, `contexto.comprovante`, `contexto.identidade.primeiroNome`, `enqueueOutboundMessage`.
- Produces: `contexto.desbloqueioRealizado: boolean`; `contexto.desbloqueioResultado: { liberado, dias, motivo }`; retorno da ferramenta à noite com `instrucao` (frases do dono); `afirmaLiberacao(texto)`, `afirmaFila(texto)` exportadas.

- [ ] **Step 1: Ferramenta à noite (teste falhando)**

No describe de `desbloqueio_confianca` em `tool-registry.test.js` (mocks já existem para `listTrustUnlocksByContract`, `sgpClient.*`, `recordTrustUnlock`; acrescente `enqueueOutboundMessage`), contexto noturno `{ ...contexto(SUSPENSO), conversationId: 'c-1', channelId: 'ch-1', identidade: { nivel: 'forte', primeiroNome: 'Willemberg' }, triagem: { noturno: { ativo: true, retornoAs: '08:00' } } }`:
- (a) elegível e SGP libera → `enqueueOutboundMessage` chamado UMA vez ANTES de `requestTrustUnlock` (compare a ordem em `mock.invocationCallOrder`) com `content` = 'Recebi seu comprovante, Willemberg! Como nossa equipe retorna a partir das 08:00, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.' e `sentBy: 'ai'`; retorno `liberado: true` com `instrucao` contendo 'Prontinho, Willemberg! O desbloqueio em confiança foi realizado' e 'a partir das 08:00' e 'Já deixei seu atendimento na fila'; `contexto.desbloqueioRealizado === true`.
- (b) sem comprovante no contexto (`contexto.comprovante` ausente): aviso vira 'Willemberg, como nossa equipe retorna a partir das 08:00, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.' (sem "Recebi seu comprovante").
- (c) regra da casa recusa → nenhum aviso enviado, `liberado: false`, `instrucao` contendo 'recebi seu comprovante e ele já está registrado' (quando há comprovante) ou 'Não consegui liberar o acesso em confiança agora' e o motivo; `contexto.desbloqueioRealizado` falsy.
- (d) `contexto.comprovante.valido === false` → recusa SEM chamar o SGP: `{ liberado: false, motivo: 'O comprovante não conferiu: ' + motivos }` e instrução de acolhimento.
- (e) de dia (sem noturno) → comportamento atual, sem `enqueueOutboundMessage` e sem `instrucao`.

- [ ] **Step 2: Ferramenta**

No `executar` de `desbloqueio_confianca`, após a checagem de status suspenso e antes da avaliação:
```js
      const noturno = contexto.triagem && contexto.triagem.noturno && contexto.triagem.noturno.ativo ? contexto.triagem.noturno : null;
      const nome = (contexto.identidade && contexto.identidade.primeiroNome) || 'cliente';
      const comprovante = contexto.comprovante || null;
      if (noturno && comprovante && comprovante.valido === false) {
        return {
          liberado: false,
          motivo: `O comprovante não conferiu: ${comprovante.motivos.join('; ')}.`,
          instrucao: `${nome}, recebi seu comprovante e ele já está registrado para a equipe conferir a partir das ${noturno.retornoAs}. Não consegui liberar o acesso em confiança agora: o comprovante não conferiu com a fatura em aberto. Assim que o pagamento for confirmado, a liberação é automática. Depois disso chame concluir_triagem para o Financeiro.`,
        };
      }
```
Depois da avaliação `ok` e antes de `requestTrustUnlock`, quando `noturno`:
```js
      if (noturno) {
        // A frase de aviso sai pelo código, antes da escrita no SGP: assim ela
        // sempre precede a execução, independente do que o modelo faria.
        const aviso = comprovante
          ? `Recebi seu comprovante, ${nome}! Como nossa equipe retorna a partir das ${noturno.retornoAs}, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.`
          : `${nome}, como nossa equipe retorna a partir das ${noturno.retornoAs}, vou verificar a possibilidade de liberar seu acesso em confiança enquanto o pagamento aguarda conferência.`;
        await enqueueOutboundMessage({ conversationId: contexto.conversationId, channelId: contexto.channelId, content: aviso, sentBy: 'ai' });
      }
```
Na recusa pela regra da casa (`!avaliacao.ok`) e na recusa do SGP, quando `noturno`, acrescente `instrucao`: `` `${nome}, ${comprovante ? 'recebi seu comprovante e ele já está registrado para a equipe conferir' : 'sua solicitação já está registrada para a equipe'} a partir das ${noturno.retornoAs}. Não consegui liberar o acesso em confiança agora: ${resposta.motivo} Assim que o pagamento for confirmado, a liberação é automática. Depois disso chame concluir_triagem para o Financeiro.` `` (para `indeterminado`, a mesma frase com 'não consegui confirmar a liberação agora'). No sucesso, quando `noturno`:
```js
      contexto.desbloqueioRealizado = true;
      contexto.desbloqueioResultado = { liberado: true, dias: resposta.dias || null };
      resposta.instrucao = `Responda EXATAMENTE neste modelo: "Prontinho, ${nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das ${noturno.retornoAs}. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?" — e chame concluir_triagem para o Financeiro NA MESMA resposta (motivo "Desbloqueio em confiança" se existir).`;
```
Run → PASS. Commit: `git commit -m "Desbloqueio à noite: aviso pelo código, frases do dono e marca de sucesso"`.

- [ ] **Step 3: Resumo da fila**

Em `concluir_triagem`, quando `noturno`, depois da linha `Modo noturno · hora` acrescente:
- se `contexto.comprovante`: `` `Comprovante (visão): ${tipo} R$ ${valor} em ${data} — ${valido ? 'conferido' : 'NÃO conferiu: ' + motivos.join('; ')}${faturaId ? `, fatura ${faturaId}` : ''}${contratoId ? ` do contrato ${contratoId}` : ''}` `` (valor com `toFixed(2)` e vírgula; data em dd/mm/aaaa via `formatarData` de `../payments/payment-card`);
- se `contexto.desbloqueioResultado`: `Desbloqueio em confiança: REALIZADO (${dias} dias)` ou `RECUSADO: ${motivo}`;
- se houve comprovante ou desbloqueio: `Pendente: conferir pagamento e dar baixa`.
Teste no describe de `concluir_triagem`: com `ctx({ triagem: { ...noturno }, comprovante: { valido: true, tipo: 'pix', valor: 135, data: '2026-09-13', faturaId: '4321', contratoId: 17402, motivos: [] }, desbloqueioResultado: { liberado: true, dias: 3 } })` o `summary` contém as três linhas. Commit.

- [ ] **Step 4: Verificador de afirmações (teste falhando)**

`ai-orchestrator.test.js`, describe de triagem:
```js
  describe('afirmações que precisam de fato', () => {
    const NOTURNO = { ...TRIAGEM, noturno: { ativo: true, retornoAs: '08:00' } };
    test('"desbloqueio realizado" sem liberação neste turno: regenera sem ferramentas com a correção', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Prontinho, João! O desbloqueio em confiança foi realizado.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'João, não consegui liberar o acesso agora; a equipe confere a partir das 08:00.' }, usage: {} });
      const r = await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      const segunda = createChatCompletion.mock.calls[1][0];
      expect(segunda.tools).toEqual([]);
      expect(segunda.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringMatching(/afirmou uma liberação que NÃO aconteceu/) })]));
      expect(r.texto).toBe('João, não consegui liberar o acesso agora; a equipe confere a partir das 08:00.');
    });
    test('"já deixei na fila" sem conclusão força concluir_triagem', async () => {
      createChatCompletion
        .mockResolvedValueOnce({ message: { content: 'Já deixei seu atendimento na fila com o comprovante.' }, usage: {} })
        .mockResolvedValueOnce({ message: { content: null, tool_calls: [{ id: 't1', function: { name: 'concluir_triagem', arguments: '{"setorId":"11111111-1111-1111-1111-111111111111","resumo":"r","confianca":0.9}' } }] }, usage: {} })
        .mockResolvedValueOnce({ message: { content: 'Registrado, João.' }, usage: {} });
      executeTool.mockResolvedValue({ ok: true, resultado: { concluido: true } });
      await runAiTurn({ conversation: CONVERSATION, contact: CONTACT, perfil: 'triagem', identidade: IDENT_FORTE, triagem: NOTURNO, origemMensagem: 'texto' });
      expect(createChatCompletion.mock.calls[1][0].toolChoice).toBe('concluir_triagem');
    });
  });
```

- [ ] **Step 5: Verificador**

Em `ai-orchestrator.js`:
```js
const AFIRMA_LIBERACAO = /desbloqueio (em confian[çc]a )?(foi |está )?(realizado|feito|conclu[íi]do)|acesso (foi |está )?liberado|liberei (seu|o) acesso|internet (foi |está )?liberada/i;
const AFIRMA_FILA = /deixei (seu |o )?(atendimento|caso|pedido) (na|em) fila|registr(ei|ado) (seu |o )?(atendimento|caso|pedido) para a equipe|já está na fila/i;
function afirmaLiberacao(texto) { return AFIRMA_LIBERACAO.test(String(texto || '')); }
function afirmaFila(texto) { return AFIRMA_FILA.test(String(texto || '')); }
```
No ramo de texto final (`chamadas.length === 0`), ANTES da guarda de anúncio:
```js
        if (perfil === 'triagem' && conteudo && !corrigiuLiberacao && !contexto.desbloqueioRealizado && afirmaLiberacao(conteudo)) {
          corrigiuLiberacao = true;
          messages.push({ role: 'assistant', content: conteudo });
          messages.push({ role: 'system', content: 'Você afirmou uma liberação que NÃO aconteceu neste atendimento. Responda de novo, sem afirmar liberação: diga que não conseguiu liberar o acesso agora, que o pedido/comprovante fica registrado para a equipe conferir no horário de retorno, e que a liberação é automática quando o pagamento for confirmado.' });
          const final = await createChatCompletion({ apiKey: config.apiKey, model: config.model, messages, tools: [] });
          promptTokens += final.usage.promptTokens || 0; completionTokens += final.usage.completionTokens || 0;
          texto = final.message.content || null;
          if (!texto) erro = 'empty_model_response';
          break;
        }
```
e a guarda de anúncio passa a disparar também com `afirmaFila(conteudo)` (mesmo bloco: `anunciaEncaminhamento(conteudo) || afirmaFila(conteudo)`). Declare `let corrigiuLiberacao = false;` junto das outras flags. Exporte `afirmaLiberacao`, `afirmaFila`. Run → PASS.

- [ ] **Step 6: Prompt do comprovante**

Em `montarContextoTriagem`, dentro do bloco noturno (Task 2), acrescente:
```js
      'COMPROVANTE À NOITE: se o cliente enviar uma imagem e disser (ou parecer) que é o pagamento, chame analisar_comprovante (sem perguntar nada antes). Se conferir e o contrato estiver SUSPENSO, chame desbloqueio_confianca do contrato indicado — a ferramenta já avisa o cliente antes de executar; depois responda EXATAMENTE com a frase que ela devolver e conclua para o Financeiro na mesma resposta. Se o comprovante não conferir, ou o contrato estiver ativo, não desbloqueie: agradeça, diga que a equipe confere a partir do horário de retorno e conclua para o Financeiro (motivo "Comprovante" se existir). Se ele pedir liberação SEM comprovante ("paguei, libera"), chame desbloqueio_confianca direto: a regra da casa decide. NUNCA diga "pagamento confirmado" nem "acesso liberado" sem a ferramenta ter devolvido liberado: true.',
```
Teste: com noturno, `sys` contém 'COMPROVANTE À NOITE' e 'chame analisar_comprovante'; sem noturno, não. Run → PASS. Commit: `git commit -m "Modo noturno: verificador de afirmações e roteiro do comprovante"`.

---

### Task 5: Roteiro de conexão à noite

**Files:**
- Modify: `src/ai/ai-orchestrator.js` (bloco noturno do prompt)
- Test: `src/ai/ai-orchestrator.test.js`

- [ ] **Step 1: Teste (falhando)**

```js
    test('à noite o roteiro de conexão tem até duas etapas e o desfecho com a hora de retorno', async () => {
      const sys = (await contexto({ triagem: NOTURNO })).messages[0].content;
      expect(sys).toMatch(/CONEXÃO À NOITE/);
      expect(sys).toMatch(/desligar o equipamento da tomada, esperar 30 segundos e ligar de novo/);
      expect(sys).toMatch(/Vou deixar seu atendimento na fila do Suporte com tudo o que verificamos\. Nossa equipe dá continuidade a partir das 08:00/);
    });
```

- [ ] **Step 2: Prompt**

No bloco noturno:
```js
      `CONEXÃO À NOITE: os mesmos roteiros de Suporte (consulte consultar_status_todos_contratos antes). Depois da pergunta de diagnóstico, faça ATÉ DUAS etapas simples, uma por mensagem: "Pode desligar o equipamento da tomada, esperar 30 segundos e ligar de novo?" e depois "A luz voltou a ficar verde?". Se resolver, encerre com encerrar_atendimento se houver motivo configurado, senão conclua para o Suporte dizendo que está tudo registrado. Se não resolver, conclua para o Suporte respondendo no modelo: "Vou deixar seu atendimento na fila do Suporte com tudo o que verificamos. Nossa equipe dá continuidade a partir das ${triagem.noturno.retornoAs}." Sem prometer técnico nem prazo. Contrato suspenso por pendência: roteiro do suspenso e, se vier comprovante, o roteiro do comprovante.`,
```
Run → PASS. `npm test` inteiro verde. Commit: `git commit -m "Modo noturno: roteiro de conexão com etapas e desfecho"`.

---

### Task 6: Teste manual (dono)

**Files:** nenhum (roteiro). Registre o resultado em `docs/superpowers/plans/2026-09-13-ai-night-mode.md` (esta seção) marcando os itens.

- [ ] Admin → IA → cartão de triagem: início = agora, fim = agora + 2 h; salvar. Admin → Canais: ligar "Atendimento noturno com IA" no canal de teste. Motivos: criar "Comprovante" e "Desbloqueio em confiança".
- [ ] Boleto pelo seu número → PDF + linha digitável + frase; "obrigado" → encerra sozinha (igual de dia).
- [ ] Contrato suspenso (26515) + comprovante válido (imagem) → aviso "Recebi seu comprovante…", desbloqueio, "Prontinho…", conversa na fila do Financeiro com resumo "Modo noturno · hh:mm / Comprovante (visão) … / Desbloqueio: REALIZADO".
- [ ] Comprovante com valor errado → sem desbloqueio, frase de acolhimento, fila do Financeiro com "NÃO conferiu".
- [ ] "Paguei, libera" sem comprovante → a regra da casa decide (30 dias / anterior paga).
- [ ] Internet offline → pergunta dos equipamentos, "desligar da tomada", "luz verde?", e "Vou deixar seu atendimento na fila do Suporte… a partir das hh:mm".
- [ ] Mensagem fora do horário comercial com noturno ligado → NÃO recebe a auto-resposta de "estamos fechados".
- [ ] Voltar a janela para 20:00–08:00.

---

## Self-review

- **Cobertura da spec:** §3 gate (T1), §4 configuração/toggle/motivos (T1; motivos são cadastro manual, T6), §5 perfil (T2), §6.1 visão (T3), §6.2/6.3 desbloqueio e frases (T4), §6.4 resumo (T4 passo 3), §7 conexão (T5), §8 garantias (T4 passos 2 e 5), §9 auto-resposta (T1 passo 7), §10 segurança (validação de MIME/tamanho em T3, caminho fora do retorno em T3, `mensagemSegura` em T3/T4), §11 testes (cada task + T6).
- **Placeholders:** nenhum "TBD"; cada passo de código tem o código.
- **Consistência de nomes:** `triagem.noturno = { ativo, retornoAs }` (T2) é o que T3/T4/T5 leem em `contexto.triagem.noturno`; `contexto.comprovante` (T3) é o que T4 lê; `contexto.desbloqueioRealizado`/`desbloqueioResultado` (T4 passo 2) são o que o verificador (T4 passo 5) e o resumo (T4 passo 3) leem; `isNightModeActive` (T1) é o que o worker usa (T2); `findLatestInboundImage`, `analyzeImage`, `conferirComprovante`, `PROMPT_VISAO` (T3) são os nomes usados na ferramenta (T3 passo 7).
