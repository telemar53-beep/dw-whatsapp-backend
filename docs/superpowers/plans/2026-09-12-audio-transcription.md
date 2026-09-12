# Transcrição de áudio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o áudio que o cliente manda no WhatsApp em texto e alimentar
com ele o fluxo de IA que já existe, sem criar uma segunda lógica de atendimento.

**Architecture:** O áudio já é baixado e persistido pelo Baileys. Uma fila nova
transcreve a partir do arquivo salvo, grava o texto na própria mensagem e avisa a
tela; só então, se autorizado, enfileira o turno de IA que já existe. Dois filtros
de texto existentes precisam passar a reconhecer áudio transcrito.

**Tech Stack:** Node.js + Express 5 + PostgreSQL + Redis/Bull + Socket.IO,
CommonJS, Jest. Frontend React 18 + Vite + Tailwind, Vitest. `axios` e `form-data`
já são dependências. **Nenhuma dependência nova.**

**Spec:** `docs/superpowers/specs/2026-09-12-audio-transcription-design.md`

## Global Constraints

- **Nenhuma dependência nova.** `form-data` (multipart) e `axios` já existem. Não
  instalar SDK da OpenAI.
- **CommonJS** no backend, 2 espaços de indentação, sem TypeScript.
- Arquivos `*.repository.js` / `*.service.js` / `*.routes.js`; teste ao lado do
  arquivo testado, nunca em `__tests__/`.
- Mensagens de erro de API em **inglês**, formato `{ error: string }`. Texto de
  interface em **português**.
- **Express 5 captura promises rejeitadas** — sem try/catch genérico nem
  `asyncHandler` nas rotas.
- **A chave da OpenAI vive só no cabeçalho HTTP.** Nunca em corpo, log ou valor de
  retorno. Erros são saneados para `{status, message}` antes de virar exceção —
  usar `mensagemSegura` de `src/ai/safe-error-log.js` para logar.
- **`transcription_enabled` nasce `false`.** Com ele desligado o sistema se comporta
  exatamente como hoje.
- **A transcrição exige três coisas:** canal com `ai_enabled`,
  `transcription_enabled`, e `transcription_model` preenchido.
- **O arquivo de áudio NÃO é temporário** — é o mesmo que o player do atendente
  usa. Nunca apagar.
- Rodar migrations no banco de teste: `npm run migrate:test -- up`. Backend:
  `npm test`. Frontend: `cd frontend && npm test`.
- Trabalhar num branch próprio (`git checkout -b audio-transcription`), não em `main`.

---

### Task 1: Migração do banco

**Files:**
- Create: `migrations/1788970000000_add-audio-transcription.js`

**Interfaces:**
- Produces: colunas `messages.transcription`, `messages.transcription_status`,
  `messages.transcription_detail`, `messages.transcription_model`,
  `messages.transcription_ms`, `messages.audio_duration_seconds`; colunas
  `ai_config.transcription_enabled`, `ai_config.transcription_model`,
  `ai_config.transcription_max_seconds`, `ai_config.transcription_max_bytes`,
  `ai_config.transcription_prompt`, `ai_config.transcription_feed_ai`.

- [ ] **Step 1: Escrever a migração**

```js
const VOCABULARIO_PADRAO =
  'DW Telecom, SGP, PPPoE, ONU, ONT, OLT, Wi-Fi, boleto, PIX, segunda via, ' +
  'fibra, roteador, conexão, plano, Mbps, mega, cliente, contrato, fatura, financeiro';

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS transcription          TEXT,
      ADD COLUMN IF NOT EXISTS transcription_status   TEXT,
      ADD COLUMN IF NOT EXISTS transcription_detail   TEXT,
      ADD COLUMN IF NOT EXISTS transcription_model    TEXT,
      ADD COLUMN IF NOT EXISTS transcription_ms       INTEGER,
      ADD COLUMN IF NOT EXISTS audio_duration_seconds INTEGER;

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_transcription_status_check;
    ALTER TABLE messages ADD CONSTRAINT messages_transcription_status_check
      CHECK (transcription_status IS NULL OR transcription_status IN
        ('pending', 'processing', 'completed', 'failed', 'skipped'));

    ALTER TABLE ai_config
      ADD COLUMN IF NOT EXISTS transcription_enabled     BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS transcription_model       TEXT    NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS transcription_max_seconds INTEGER NOT NULL DEFAULT 300,
      ADD COLUMN IF NOT EXISTS transcription_max_bytes   INTEGER NOT NULL DEFAULT 26214400,
      ADD COLUMN IF NOT EXISTS transcription_prompt      TEXT    NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS transcription_feed_ai     BOOLEAN NOT NULL DEFAULT true;
  `);

  pgm.sql(`UPDATE ai_config SET transcription_prompt = $SEED$${VOCABULARIO_PADRAO}$SEED$ WHERE id = 1 AND transcription_prompt = '';`);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_config
      DROP COLUMN IF EXISTS transcription_feed_ai,
      DROP COLUMN IF EXISTS transcription_prompt,
      DROP COLUMN IF EXISTS transcription_max_bytes,
      DROP COLUMN IF EXISTS transcription_max_seconds,
      DROP COLUMN IF EXISTS transcription_model,
      DROP COLUMN IF EXISTS transcription_enabled;

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_transcription_status_check;
    ALTER TABLE messages
      DROP COLUMN IF EXISTS audio_duration_seconds,
      DROP COLUMN IF EXISTS transcription_ms,
      DROP COLUMN IF EXISTS transcription_model,
      DROP COLUMN IF EXISTS transcription_detail,
      DROP COLUMN IF EXISTS transcription_status,
      DROP COLUMN IF EXISTS transcription;
  `);
};
```

**Nota sobre dollar-quoting:** o `$SEED$` evita passar o texto como parâmetro do
`pgm.sql`, recurso que não se confirmou existir nesta versão do `node-pg-migrate`
e que nenhuma das 37 migrations do projeto usa.

- [ ] **Step 2: Aplicar no banco de teste**

Run: `npm run migrate:test -- up`
Expected: `1788970000000_add-audio-transcription` aplicada, sem erro.

- [ ] **Step 3: Verificar as colunas e o vocabulário semeado**

Run:
```bash
node -e "
require('dotenv').config({path:'.env.test'});
const {getPool,closePool}=require('./src/db/pool');
(async()=>{
  const c = await getPool().query(\"SELECT column_name FROM information_schema.columns WHERE table_name='messages' AND (column_name LIKE 'transcription%' OR column_name='audio_duration_seconds')\");
  console.log('colunas em messages:', c.rows.map(r=>r.column_name).sort());
  const a = await getPool().query('SELECT transcription_enabled, transcription_max_seconds, length(transcription_prompt) AS vocab FROM ai_config');
  console.log('ai_config:', a.rows);
  await closePool();
})();"
```
Expected: seis colunas em `messages`; `transcription_enabled: false`,
`transcription_max_seconds: 300`, `vocab` maior que 100.

- [ ] **Step 4: Round trip do down**

Run: `npm run migrate:test -- down && npm run migrate:test -- up`
Expected: os dois passam sem erro.

- [ ] **Step 5: Suíte completa**

Run: `npm test`
Expected: PASS — migração aditiva, nenhum teste existente muda.

- [ ] **Step 6: Commit**

```bash
git add migrations/1788970000000_add-audio-transcription.js
git commit -m "Add database columns for audio transcription"
```

---

### Task 2: `message.repository` — colunas, mapper e escrita da transcrição

**Files:**
- Modify: `src/conversations/message.repository.js`
- Test: `src/conversations/message.repository.test.js`

**Interfaces:**
- Produces:
  - `toMessage` passa a devolver `transcription`, `transcriptionStatus`,
    `transcriptionDetail`, `transcriptionModel`, `transcriptionMs`,
    `audioDurationSeconds`
  - `markTranscriptionPending(messageId, audioDurationSeconds)` → `Promise<message|null>`
  - `markTranscriptionProcessing(messageId)` → `Promise<message|null>`
  - `saveTranscription(messageId, { transcription, model, ms })` → `Promise<message|null>`
  - `markTranscriptionFailed(messageId, { status, detail, ms })` → `Promise<message|null>`
    (`status` é `'failed'` ou `'skipped'`)

**ATENÇÃO — a armadilha das colunas.** Este arquivo **não usa `SELECT *`**. As seis
colunas novas precisam entrar em **três** lugares, e esquecer qualquer um faz a
transcrição chegar `undefined` na tela mesmo estando gravada:

1. a constante `MESSAGE_COLUMNS` (linha ~32) — cobre a maioria das consultas;
2. a lista inline de `listMessagesByConversation` (linha ~114), que faz `JOIN`;
3. a lista inline de `listRecentMessagesByConversation` (linha ~138), idem.

Confira os números de linha você mesmo antes de editar.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `src/conversations/message.repository.test.js` (importar as quatro
funções novas no require do topo):

```js
  test('uma mensagem de áudio carrega os campos de transcrição em branco por padrão', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-1',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    expect(message.transcription).toBeNull();
    expect(message.transcriptionStatus).toBeNull();
    expect(message.audioDurationSeconds).toBeNull();
  });

  test('markTranscriptionPending grava o status e a duração', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-2',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    const updated = await markTranscriptionPending(message.id, 42);
    expect(updated.transcriptionStatus).toBe('pending');
    expect(updated.audioDurationSeconds).toBe(42);
  });

  test('saveTranscription grava texto, modelo e tempo, e marca completed', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-3',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    const updated = await saveTranscription(message.id, {
      transcription: 'minha internet caiu', model: 'modelo-x', ms: 1234,
    });
    expect(updated.transcription).toBe('minha internet caiu');
    expect(updated.transcriptionStatus).toBe('completed');
    expect(updated.transcriptionModel).toBe('modelo-x');
    expect(updated.transcriptionMs).toBe(1234);
  });

  test('markTranscriptionFailed aceita failed e skipped com motivo', async () => {
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-4',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    const falhou = await markTranscriptionFailed(message.id, { status: 'failed', detail: 'timeout', ms: 900 });
    expect(falhou.transcriptionStatus).toBe('failed');
    expect(falhou.transcriptionDetail).toBe('timeout');

    const pulado = await markTranscriptionFailed(message.id, { status: 'skipped', detail: 'áudio longo demais', ms: null });
    expect(pulado.transcriptionStatus).toBe('skipped');
  });

  test('as funções devolvem null para id inexistente', async () => {
    expect(await markTranscriptionProcessing('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('a transcrição chega por listMessagesByConversation, não só pelo RETURNING', async () => {
    // Este é o teste que pega a armadilha das colunas enumeradas: escreve por uma
    // função e relê por OUTRA. Se a coluna faltar na lista inline daquela consulta,
    // o texto vem undefined mesmo estando no banco.
    const message = await createMessage({
      conversationId, direction: 'inbound', content: null, whatsappMessageId: 'wa-audio-5',
      status: 'received', messageType: 'audio', mediaPath: 'x.ogg', mediaMimeType: 'audio/ogg',
    });
    await saveTranscription(message.id, { transcription: 'texto relido', model: 'm', ms: 10 });

    const lista = await listMessagesByConversation(conversationId);
    const relida = lista.find((m) => m.id === message.id);
    expect(relida.transcription).toBe('texto relido');
    expect(relida.transcriptionStatus).toBe('completed');

    const recentes = await listRecentMessagesByConversation(conversationId, 50);
    const naRecente = recentes.find((m) => m.id === message.id);
    expect(naRecente.transcription).toBe('texto relido');
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/conversations/message.repository.test.js`
Expected: FAIL — `markTranscriptionPending is not a function`

- [ ] **Step 3: Acrescentar as colunas nos três lugares e no mapper**

Em `MESSAGE_COLUMNS`, acrescentar ao fim da lista:

```
transcription, transcription_status, transcription_detail,
       transcription_model, transcription_ms, audio_duration_seconds
```

Nas duas consultas inline (as que fazem `LEFT JOIN messages rm`), acrescentar com
o prefixo da tabela:

```
m.transcription, m.transcription_status, m.transcription_detail,
m.transcription_model, m.transcription_ms, m.audio_duration_seconds
```

No mapper `toMessage`, antes de `createdAt`:

```js
    transcription: row.transcription,
    transcriptionStatus: row.transcription_status,
    transcriptionDetail: row.transcription_detail,
    transcriptionModel: row.transcription_model,
    transcriptionMs: row.transcription_ms,
    audioDurationSeconds: row.audio_duration_seconds,
```

- [ ] **Step 4: Implementar as quatro funções**

```js
async function markTranscriptionPending(messageId, audioDurationSeconds) {
  const result = await getPool().query(
    `UPDATE messages SET transcription_status = 'pending', audio_duration_seconds = $2
     WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, audioDurationSeconds !== undefined ? audioDurationSeconds : null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function markTranscriptionProcessing(messageId) {
  const result = await getPool().query(
    `UPDATE messages SET transcription_status = 'processing'
     WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function saveTranscription(messageId, { transcription, model, ms }) {
  const result = await getPool().query(
    `UPDATE messages
        SET transcription = $2, transcription_status = 'completed',
            transcription_model = $3, transcription_ms = $4, transcription_detail = NULL
      WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, transcription, model, ms !== undefined ? ms : null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function markTranscriptionFailed(messageId, { status, detail, ms }) {
  const result = await getPool().query(
    `UPDATE messages
        SET transcription_status = $2, transcription_detail = $3, transcription_ms = $4
      WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, status, detail || null, ms !== undefined ? ms : null]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}
```

Exportar as quatro.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm test -- src/conversations/message.repository.test.js`
Expected: PASS

- [ ] **Step 6: Suíte completa**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/conversations/message.repository.js src/conversations/message.repository.test.js
git commit -m "Carry transcription fields on messages through every read path"
```

---

### Task 3: `ai-config.repository` — configuração de transcrição

**Files:**
- Modify: `src/ai/ai-config.repository.js`
- Test: `src/ai/ai-config.repository.test.js`

**Interfaces:**
- Produces: `getAiConfig()` passa a devolver `transcriptionEnabled`,
  `transcriptionModel`, `transcriptionMaxSeconds`, `transcriptionMaxBytes`,
  `transcriptionPrompt`, `transcriptionFeedAi`;
  `updateTranscriptionConfig({ transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds, transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi })` → mesma forma.

**Nota:** este repositório usa `SELECT * FROM ai_config`, então **basta o mapper** —
a armadilha das colunas enumeradas não se aplica aqui.

- [ ] **Step 1: Escrever os testes que falham**

```js
  test('getAiConfig devolve os campos de transcrição com os defaults', async () => {
    const config = await getAiConfig();
    expect(config.transcriptionEnabled).toBe(false);
    expect(config.transcriptionMaxSeconds).toBe(300);
    expect(config.transcriptionMaxBytes).toBe(26214400);
    expect(config.transcriptionFeedAi).toBe(true);
    expect(typeof config.transcriptionPrompt).toBe('string');
  });

  test('updateTranscriptionConfig grava e relê', async () => {
    const updated = await updateTranscriptionConfig({
      transcriptionEnabled: true,
      transcriptionModel: 'modelo-transcricao',
      transcriptionMaxSeconds: 120,
      transcriptionMaxBytes: 1048576,
      transcriptionPrompt: 'PPPoE, ONU',
      transcriptionFeedAi: false,
    });
    expect(updated.transcriptionEnabled).toBe(true);
    expect(updated.transcriptionModel).toBe('modelo-transcricao');
    expect(updated.transcriptionFeedAi).toBe(false);

    const relido = await getAiConfig();
    expect(relido.transcriptionMaxSeconds).toBe(120);
    expect(relido.transcriptionPrompt).toBe('PPPoE, ONU');
  });

  test('updateTranscriptionConfig não mexe na configuração de chat', async () => {
    await updateAiConfig({ apiKey: 'sk-chat', model: 'gpt-chat', mode: 'assistant' });
    await updateTranscriptionConfig({
      transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
      transcriptionMaxBytes: 1000, transcriptionPrompt: '', transcriptionFeedAi: true,
    });
    const config = await getAiConfig();
    expect(config.apiKey).toBe('sk-chat');
    expect(config.model).toBe('gpt-chat');
    expect(config.mode).toBe('assistant');
  });
```

Acrescentar ao `beforeEach` existente o reset dos campos novos:

```js
    await getPool().query(
      "UPDATE ai_config SET transcription_enabled = false, transcription_model = '', " +
      'transcription_max_seconds = 300, transcription_max_bytes = 26214400, ' +
      'transcription_feed_ai = true WHERE id = 1'
    );
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/ai/ai-config.repository.test.js`
Expected: FAIL — `undefined` nos campos novos

- [ ] **Step 3: Implementar**

No mapper `toConfig`, acrescentar:

```js
    transcriptionEnabled: row.transcription_enabled,
    transcriptionModel: row.transcription_model,
    transcriptionMaxSeconds: row.transcription_max_seconds,
    transcriptionMaxBytes: row.transcription_max_bytes,
    transcriptionPrompt: row.transcription_prompt,
    transcriptionFeedAi: row.transcription_feed_ai,
```

E a função nova:

```js
async function updateTranscriptionConfig({
  transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds,
  transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi,
}) {
  const result = await getPool().query(
    `UPDATE ai_config
        SET transcription_enabled = $1, transcription_model = $2,
            transcription_max_seconds = $3, transcription_max_bytes = $4,
            transcription_prompt = $5, transcription_feed_ai = $6, updated_at = now()
      WHERE id = 1 RETURNING *`,
    [transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds,
     transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi]
  );
  return toConfig(result.rows[0]);
}
```

Exportar.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/ai/ai-config.repository.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/ai-config.repository.js src/ai/ai-config.repository.test.js
git commit -m "Add transcription settings to the AI configuration"
```

---

### Task 4: `transcribeAudio` no cliente da OpenAI

**Files:**
- Modify: `src/ai/openai-client.js`
- Test: `src/ai/openai-client.test.js`

**Interfaces:**
- Consumes: `headers(apiKey)` e `traduzErro(err, contexto)` já existentes no módulo.
- Produces: `transcribeAudio({ apiKey, model, filePath, mimeType, prompt })` →
  `Promise<{ texto: string }>`; lança `OpenAiAuthError` em 401 e `OpenAiRequestError`
  no resto.

- [ ] **Step 1: Escrever os testes que falham**

```js
  describe('transcribeAudio', () => {
    const fs = require('fs');

    test('manda a chave só no cabeçalho e o modelo no formulário', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockResolvedValue({ data: { text: 'minha internet caiu' } });
      // Spy no append em vez de espiar o interno `_streams` do form-data: se a
      // chave algum dia for anexada ao corpo, ESTA asserção falha. Uma checagem
      // sobre `_streams` passaria a vazio caso a propriedade não exista.
      const appendSpy = jest.spyOn(FormData.prototype, 'append');

      const result = await transcribeAudio({
        apiKey: 'sk-secreta', model: 'modelo-x', filePath: '/tmp/a.ogg',
        mimeType: 'audio/ogg', prompt: 'PPPoE, ONU',
      });

      const [url, , options] = axios.post.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect(options.headers.Authorization).toBe('Bearer sk-secreta');
      // Guarda de regressão do boundary. A checagem de formato abaixo NÃO basta
      // sozinha: com o axios mockado não existe colisão case-insensitive, então
      // ela passa mesmo com o bug presente. Quem realmente trava o defeito é a
      // segunda asserção — com o merge errado, 'Content-Type' chega
      // 'application/json' e ela falha.
      const contentType = options.headers['content-type'] || options.headers['Content-Type'];
      expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(options.headers['Content-Type']).toBeUndefined();
      expect(result).toEqual({ texto: 'minha internet caiu' });

      const campos = appendSpy.mock.calls.map((c) => c[0]);
      expect(campos).toContain('model');
      expect(campos).toContain('file');
      expect(campos).toContain('prompt');
      expect(appendSpy.mock.calls.some((c) => String(c[1]).includes('sk-secreta'))).toBe(false);

      appendSpy.mockRestore();
      fs.createReadStream.mockRestore();
    });

    test('devolve apenas o texto, ignorando campos extras da resposta', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockResolvedValue({ data: { text: 'oi', language: 'pt', duration: 3.2, segments: [] } });
      const result = await transcribeAudio({ apiKey: 'sk', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' });
      expect(result).toEqual({ texto: 'oi' });
      fs.createReadStream.mockRestore();
    });

    test('401 vira OpenAiAuthError', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      axios.post.mockRejectedValue({ response: { status: 401 }, message: 'bad key' });
      await expect(
        transcribeAudio({ apiKey: 'sk', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' })
      ).rejects.toBeInstanceOf(OpenAiAuthError);
      fs.createReadStream.mockRestore();
    });

    test('a chave não vaza pela causa do erro', async () => {
      jest.spyOn(fs, 'createReadStream').mockReturnValue('STREAM_FALSO');
      const erroReal = new Error('Request failed with status code 500');
      erroReal.response = { status: 500 };
      erroReal.config = { headers: { Authorization: 'Bearer sk-secreta' }, data: 'binario' };
      axios.post.mockRejectedValue(erroReal);

      let capturado;
      try {
        await transcribeAudio({ apiKey: 'sk-secreta', model: 'm', filePath: '/tmp/a.ogg', mimeType: 'audio/ogg' });
      } catch (err) {
        capturado = err;
      }
      const serializado = JSON.stringify(capturado) + JSON.stringify(capturado.cause);
      expect(serializado).not.toContain('sk-secreta');
      expect(serializado).not.toContain('Bearer');
      fs.createReadStream.mockRestore();
    });
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/ai/openai-client.test.js`
Expected: FAIL — `transcribeAudio is not a function`

- [ ] **Step 3: Implementar**

No topo do arquivo, ao lado dos requires existentes:

```js
const fs = require('fs');
const FormData = require('form-data');
```

E a função, antes do `module.exports`:

```js
const TRANSCRIPTION_TIMEOUT_MS = 120000;

async function transcribeAudio({ apiKey, model, filePath, mimeType, prompt }) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: 'audio' + (mimeType === 'audio/mpeg' ? '.mp3' : '.ogg'),
    contentType: mimeType || 'audio/ogg',
  });
  form.append('model', model);
  if (prompt) form.append('prompt', prompt);

  let response;
  try {
    response = await axios.post(`${BASE_URL}/audio/transcriptions`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
      timeout: TRANSCRIPTION_TIMEOUT_MS,
      maxBodyLength: Infinity,
    });
  } catch (err) {
    throw traduzErro(err, '/audio/transcriptions');
  }

  // Só o texto é lido: a resposta traz campos diferentes conforme o modelo e o
  // formato pedido, e o módulo não deve quebrar quando o admin trocar de modelo.
  return { texto: (response.data && response.data.text) || '' };
}
```

**Só o `Authorization` é espalhado, nunca o `headers(apiKey)` inteiro.** Aquele
helper carrega `'Content-Type': 'application/json'`, e o `AxiosHeaders` casa nomes
de cabeçalho sem diferenciar maiúsculas: o `Content-Type` do helper sobrescreveria
o `content-type` multipart que o `form-data` acabou de montar, apagando o
`boundary`. O corpo sairia rotulado como JSON e a OpenAI não conseguiria lê-lo —
sem erro local, sem teste falhando. É o mesmo formato usado em
`meta-cloud.adapter.js:105`.

Acrescentar `transcribeAudio` ao `module.exports`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/ai/openai-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/openai-client.js src/ai/openai-client.test.js
git commit -m "Add the OpenAI audio transcription call"
```

---

### Task 5: `transcription.service`

**Files:**
- Create: `src/ai/transcription.service.js`
- Test: `src/ai/transcription.service.test.js`

**Interfaces:**
- Consumes: `getAiConfig` (Task 3); `transcribeAudio` (Task 4); as quatro funções
  de transcrição e `findMessageById` de `message.repository` (Task 2);
  `getMediaFilePath` de `src/media/media-storage.js`.
- Produces: `transcribeMessage(messageId)` →
  `Promise<{ ok: true, transcription } | { ok: false, motivo }>`
  Motivos: `'not_audio'`, `'no_media'`, `'disabled'`, `'unsupported_mime'`, `'too_long'`,
  `'too_large'`, `'transcription_failed'`.

**Divergência deliberada da spec.** A spec listava "emite o evento de socket" como
passo 6 do serviço. O plano emite no **worker** (Task 6): o serviço fica puro e
testável sem mock de socket, e o worker já precisa carregar a conversa para decidir
sobre a IA. O evento continua saindo nos mesmos casos — sucesso e falha.

- [ ] **Step 1: Escrever os testes que falham**

```js
jest.mock('./ai-config.repository');
jest.mock('./openai-client');
jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');

const fs = require('fs');
const { getAiConfig } = require('./ai-config.repository');
const { transcribeAudio, OpenAiRequestError } = require('./openai-client');
const {
  findMessageById, markTranscriptionProcessing, saveTranscription, markTranscriptionFailed,
} = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');
const { transcribeMessage } = require('./transcription.service');

const CONFIG = {
  transcriptionEnabled: true, transcriptionModel: 'modelo-x',
  transcriptionMaxSeconds: 300, transcriptionMaxBytes: 1000000,
  transcriptionPrompt: 'PPPoE, ONU', apiKey: 'sk-chave',
};

const AUDIO = {
  id: 'm-1', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg',
  audioDurationSeconds: 30,
};

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue(CONFIG);
  getMediaFilePath.mockReturnValue('/media/a.ogg');
  jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 500 });
});

afterEach(() => {
  if (fs.promises.stat.mockRestore) fs.promises.stat.mockRestore();
});

describe('transcribeMessage', () => {
  test('transcreve e grava o texto', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    transcribeAudio.mockResolvedValue({ texto: 'minha internet caiu' });
    saveTranscription.mockResolvedValue({ ...AUDIO, transcription: 'minha internet caiu' });

    const result = await transcribeMessage('m-1');

    expect(markTranscriptionProcessing).toHaveBeenCalledWith('m-1');
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-chave', model: 'modelo-x', filePath: '/media/a.ogg', prompt: 'PPPoE, ONU',
    }));
    expect(saveTranscription).toHaveBeenCalledWith('m-1', expect.objectContaining({
      transcription: 'minha internet caiu', model: 'modelo-x',
    }));
    expect(result.ok).toBe(true);
  });

  test('aceita o MIME com parâmetro de codec que o WhatsApp manda', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, mediaMimeType: 'audio/ogg; codecs=opus' });
    transcribeAudio.mockResolvedValue({ texto: 'ok' });
    saveTranscription.mockResolvedValue({});
    const result = await transcribeMessage('m-1');
    expect(result.ok).toBe(true);
  });

  test('recusa formato não suportado antes de qualquer chamada à OpenAI', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, mediaMimeType: 'application/pdf' });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'unsupported_mime' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('recusa mensagem que não é áudio', async () => {
    findMessageById.mockResolvedValue({ id: 'm-2', messageType: 'text', content: 'oi' });
    const result = await transcribeMessage('m-2');
    expect(result).toEqual({ ok: false, motivo: 'not_audio' });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test('áudio longo demais é skipped, não failed', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, audioDurationSeconds: 999 });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'too_long' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('caminho de mídia inválido vira failed, não deixa a mensagem pendurada', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    getMediaFilePath.mockImplementation(() => { throw new Error('Invalid media path'); });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'no_media' });
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
  });

  test('arquivo grande demais é skipped', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    fs.promises.stat.mockResolvedValue({ size: 99999999 });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'too_large' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('falha da API marca failed e nunca inventa texto', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    transcribeAudio.mockRejectedValue(new OpenAiRequestError('caiu'));
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'transcription_failed' });
    expect(saveTranscription).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
  });

  test('texto vazio da API é tratado como falha, não como transcrição vazia', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    transcribeAudio.mockResolvedValue({ texto: '   ' });
    const result = await transcribeMessage('m-1');
    expect(result.ok).toBe(false);
    expect(saveTranscription).not.toHaveBeenCalled();
  });

  test('duração ausente não bloqueia — o limite de tamanho ainda protege', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, audioDurationSeconds: null });
    transcribeAudio.mockResolvedValue({ texto: 'ok' });
    saveTranscription.mockResolvedValue({});
    const result = await transcribeMessage('m-1');
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/ai/transcription.service.test.js`
Expected: FAIL — módulo não encontrado

- [ ] **Step 3: Implementar**

```js
const fs = require('fs');
const { getAiConfig } = require('./ai-config.repository');
const { transcribeAudio } = require('./openai-client');
const {
  findMessageById,
  markTranscriptionProcessing,
  saveTranscription,
  markTranscriptionFailed,
} = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');
const { mensagemSegura } = require('./safe-error-log');

// O WhatsApp manda nota de voz como 'audio/ogg; codecs=opus' — o parâmetro depois
// do ';' faz parte do cabeçalho e precisa ser cortado antes de comparar.
const MIME_ACEITOS = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm'];

function mimeAceito(mimeType) {
  if (!mimeType) return false;
  return MIME_ACEITOS.includes(mimeType.split(';')[0].trim().toLowerCase());
}

function recusa(motivo) {
  return { ok: false, motivo };
}

/**
 * Transcreve o áudio de uma mensagem já persistida. O arquivo NÃO é temporário:
 * é o mesmo que o player do atendente usa, então nunca é apagado aqui.
 */
async function transcribeMessage(messageId) {
  const message = await findMessageById(messageId);
  if (!message || message.messageType !== 'audio') return recusa('not_audio');

  if (!message.mediaPath) {
    await markTranscriptionFailed(messageId, { status: 'failed', detail: 'mensagem de áudio sem arquivo', ms: null });
    return recusa('no_media');
  }

  if (!mimeAceito(message.mediaMimeType)) {
    await markTranscriptionFailed(messageId, {
      status: 'skipped', detail: 'formato de áudio não suportado', ms: null,
    });
    return recusa('unsupported_mime');
  }

  const config = await getAiConfig();
  const iniciadoEm = Date.now();

  // Trava de desligamento. O gate em shouldTranscribe roda no enfileiramento; um
  // job já na fila quando o admin desliga chegaria aqui e gastaria uma chamada
  // paga à OpenAI depois de desligada. Este é o ponto único por onde toda
  // transcrição passa, então a trava mora aqui e não no worker.
  if (!config.transcriptionEnabled) {
    await markTranscriptionFailed(messageId, { status: 'skipped', detail: 'transcrição desativada', ms: null });
    return recusa('disabled');
  }

  // Limite de duração: só aplica quando o metadado do WhatsApp trouxe o valor.
  if (message.audioDurationSeconds && message.audioDurationSeconds > config.transcriptionMaxSeconds) {
    await markTranscriptionFailed(messageId, {
      status: 'skipped',
      detail: `áudio de ${message.audioDurationSeconds}s acima do limite de ${config.transcriptionMaxSeconds}s`,
      ms: null,
    });
    return recusa('too_long');
  }

  // getMediaFilePath LANÇA em caminho suspeito (proteção contra path traversal).
  // Sem este try/catch a mensagem ficaria 'pending' para sempre e a tela mostraria
  // "Transcrevendo…" eternamente.
  let filePath;
  let stats;
  try {
    filePath = getMediaFilePath(message.mediaPath);
    stats = await fs.promises.stat(filePath);
  } catch (err) {
    await markTranscriptionFailed(messageId, { status: 'failed', detail: 'arquivo de áudio não encontrado', ms: null });
    return recusa('no_media');
  }

  if (stats.size > config.transcriptionMaxBytes) {
    await markTranscriptionFailed(messageId, {
      status: 'skipped',
      detail: `arquivo de ${stats.size} bytes acima do limite de ${config.transcriptionMaxBytes}`,
      ms: null,
    });
    return recusa('too_large');
  }

  await markTranscriptionProcessing(messageId);

  let resultado;
  try {
    resultado = await transcribeAudio({
      apiKey: config.apiKey,
      model: config.transcriptionModel,
      filePath,
      mimeType: message.mediaMimeType,
      prompt: config.transcriptionPrompt || undefined,
    });
  } catch (err) {
    console.error(`Transcription failed for message ${messageId}: ${mensagemSegura(err)}`);
    await markTranscriptionFailed(messageId, {
      status: 'failed', detail: mensagemSegura(err), ms: Date.now() - iniciadoEm,
    });
    return recusa('transcription_failed');
  }

  const texto = (resultado.texto || '').trim();
  if (!texto) {
    // Texto vazio não vira transcrição vazia: a IA jamais deve receber conteúdo
    // em branco e responder como se tivesse entendido algo.
    await markTranscriptionFailed(messageId, {
      status: 'failed', detail: 'transcrição vazia', ms: Date.now() - iniciadoEm,
    });
    return recusa('transcription_failed');
  }

  await saveTranscription(messageId, {
    transcription: texto,
    model: config.transcriptionModel,
    ms: Date.now() - iniciadoEm,
  });
  return { ok: true, transcription: texto };
}

module.exports = { transcribeMessage };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/ai/transcription.service.test.js`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add src/ai/transcription.service.js src/ai/transcription.service.test.js
git commit -m "Add the audio transcription service"
```

---

### Task 6: Fila e worker de transcrição

**Files:**
- Create: `src/queue/transcription-queue.js`
- Create: `src/queue/transcription-worker.js`
- Test: `src/queue/transcription-queue.test.js`
- Test: `src/queue/transcription-worker.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `transcribeMessage` (Task 5); `getAiConfig` (Task 3);
  `getConversationWithContact`; `enqueueAiReply` de `src/queue/ai-queue.js`;
  `emitToAgent`/`broadcast` de `src/realtime/socket-server.js`;
  `findMessageById` de `message.repository`.
- Produces: `enqueueTranscription({ conversationId, messageId })`;
  `processTranscriptionQueue(handler)`; `closeTranscriptionQueue()`;
  `startTranscriptionWorker()`; `handleTranscriptionJob({ conversationId, messageId })`.

**Fila separada da de IA de propósito:** transcrição é mais lenta e falha mais que
uma chamada de chat, e o Bull roda com concorrência 1. Compartilhar faria um áudio
longo segurar as respostas de texto de todas as outras conversas.

- [ ] **Step 1: Escrever o teste da fila**

```js
jest.mock('bull');
const Queue = require('bull');

const addMock = jest.fn();
Queue.mockImplementation(() => ({ add: addMock, process: jest.fn(), close: jest.fn() }));

const { enqueueTranscription } = require('./transcription-queue');

describe('transcription-queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enfileira com os dois ids e sem repetição automática', async () => {
    await enqueueTranscription({ conversationId: 'c-1', messageId: 'm-1' });
    expect(addMock).toHaveBeenCalledWith(
      { conversationId: 'c-1', messageId: 'm-1' },
      expect.objectContaining({ attempts: 1, removeOnComplete: true, removeOnFail: true })
    );
  });

  test('não usa jobId customizado', async () => {
    await enqueueTranscription({ conversationId: 'c-1', messageId: 'm-1' });
    expect(addMock.mock.calls[0][1].jobId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implementar a fila**

```js
const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getTranscriptionQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('audio-transcriptions', config.redisUrl);
  }
  return queue;
}

/**
 * Sem jobId customizado: cada áudio é um job independente, e dois áudios em
 * sequência devem ser transcritos os dois — diferente do turno de IA, onde só a
 * última mensagem interessa. Sem repetição automática: uma transcrição que falhou
 * fica registrada na própria mensagem, que é onde o atendente e o painel a procuram.
 */
async function enqueueTranscription({ conversationId, messageId }) {
  await getTranscriptionQueue().add(
    { conversationId, messageId },
    { attempts: 1, removeOnComplete: true, removeOnFail: true }
  );
}

function processTranscriptionQueue(handler) {
  getTranscriptionQueue().process(async (job) => handler(job.data));
}

async function closeTranscriptionQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = {
  getTranscriptionQueue, enqueueTranscription, processTranscriptionQueue, closeTranscriptionQueue,
};
```

- [ ] **Step 3: Escrever o teste do worker**

```js
jest.mock('./transcription-queue');
jest.mock('../ai/transcription.service');
jest.mock('../ai/ai-config.repository');
jest.mock('../ai/ai.service');
jest.mock('../queue/ai-queue');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../realtime/socket-server');

const { transcribeMessage } = require('../ai/transcription.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { shouldRunAi } = require('../ai/ai.service');
const { enqueueAiReply } = require('./ai-queue');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById } = require('../conversations/message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { handleTranscriptionJob } = require('./transcription-worker');

beforeEach(() => {
  jest.clearAllMocks();
  getConversationWithContact.mockResolvedValue({ id: 'c-1', channelId: 'ch-1', assignedAgentId: 'a-1' });
  findMessageById.mockResolvedValue({ id: 'm-1', transcription: 'texto', transcriptionStatus: 'completed' });
  getAiConfig.mockResolvedValue({ transcriptionFeedAi: true });
  shouldRunAi.mockResolvedValue(true);
});

describe('transcription-worker', () => {
  test('transcreve, avisa a tela e enfileira o turno de IA', async () => {
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(emitToAgent).toHaveBeenCalledWith('a-1', 'message:transcription', expect.objectContaining({
      conversationId: 'c-1', messageId: 'm-1',
    }));
    expect(enqueueAiReply).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: 'm-1' });
  });

  test('avisa a fila quando a conversa não tem atendente', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'c-1', channelId: 'ch-1', assignedAgentId: null });
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(broadcast).toHaveBeenCalledWith('message:transcription', expect.any(Object));
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('transcrição falha: avisa a tela mas NÃO enfileira a IA', async () => {
    transcribeMessage.mockResolvedValue({ ok: false, motivo: 'transcription_failed' });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(emitToAgent).toHaveBeenCalled();
    expect(enqueueAiReply).not.toHaveBeenCalled();
  });

  test('com transcriptionFeedAi desligado, transcreve mas não aciona a IA', async () => {
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });
    getAiConfig.mockResolvedValue({ transcriptionFeedAi: false });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(emitToAgent).toHaveBeenCalled();
    expect(enqueueAiReply).not.toHaveBeenCalled();
  });

  test('não aciona a IA quando o canal não a tem ligada', async () => {
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });
    shouldRunAi.mockResolvedValue(false);

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(enqueueAiReply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implementar o worker**

```js
const { processTranscriptionQueue } = require('./transcription-queue');
const { transcribeMessage } = require('../ai/transcription.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { shouldRunAi } = require('../ai/ai.service');
const { enqueueAiReply } = require('./ai-queue');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById } = require('../conversations/message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { mensagemSegura } = require('../ai/safe-error-log');

async function handleTranscriptionJob({ conversationId, messageId }) {
  const resultado = await transcribeMessage(messageId);

  // A tela é avisada nos dois casos: o atendente precisa ver tanto o texto
  // quanto o aviso de que não foi possível transcrever.
  const conversation = await getConversationWithContact(conversationId);
  const message = await findMessageById(messageId);
  const payload = {
    conversationId,
    messageId,
    transcription: message ? message.transcription : null,
    transcriptionStatus: message ? message.transcriptionStatus : null,
    transcriptionDetail: message ? message.transcriptionDetail : null,
  };
  if (conversation && conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:transcription', payload);
  } else {
    broadcast('message:transcription', payload);
  }

  if (!resultado.ok) return;

  const config = await getAiConfig();
  if (!config || !config.transcriptionFeedAi) return;
  if (!conversation || !(await shouldRunAi(conversation.channelId))) return;

  await enqueueAiReply({ conversationId, messageId });
}

function startTranscriptionWorker() {
  processTranscriptionQueue(async (data) => {
    try {
      await handleTranscriptionJob(data);
    } catch (err) {
      console.error(`Transcription job failed for message ${data.messageId}: ${mensagemSegura(err)}`);
    }
  });
}

module.exports = { startTranscriptionWorker, handleTranscriptionJob };
```

- [ ] **Step 5: Iniciar o worker no `server.js`**

Dentro do bloco `if (require.main === module)`, ao lado de `startAiWorker()`:

```js
  const { startTranscriptionWorker } = require('./queue/transcription-worker');
  ...
  startTranscriptionWorker();
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npm test -- src/queue/transcription-queue.test.js src/queue/transcription-worker.test.js`
Expected: PASS (2 + 5 testes)

- [ ] **Step 7: Commit**

```bash
git add src/queue/transcription-queue.js src/queue/transcription-worker.js src/queue/transcription-queue.test.js src/queue/transcription-worker.test.js src/server.js
git commit -m "Run audio transcription in its own queue"
```

---

### Task 7: Gancho na ingestão e os dois pontos de integração

**Files:**
- Modify: `src/ai/ai.service.js`
- Modify: `src/conversations/inbound-message.service.js`
- Modify: `src/conversations/message.repository.js` (`findLatestInboundMessageId`)
- Modify: `src/ai/ai-orchestrator.js` (histórico)
- Modify: `src/whatsapp-adapters/baileys.manager.js` (duração do áudio)
- Test: `src/ai/ai.service.test.js`
- Test: `src/conversations/inbound-message.service.test.js`
- Test: `src/conversations/message.repository.test.js`
- Test: `src/ai/ai-orchestrator.test.js`

**Interfaces:**
- Produces: `shouldTranscribe(channelId)` → `Promise<boolean>`;
  `scheduleTranscription(conversation, message, audioDurationSeconds)` → `Promise<void>`.

**A duração NÃO passa por `createMessage`.** O valor vem do metadado do Baileys e é
gravado pelo `UPDATE` de `markTranscriptionPending`, que já acontece. Enfiá-lo no
`INSERT` de `createMessage` obrigaria a mexer na lista de colunas, no `VALUES` e no
array posicional do caminho quente por onde passa **toda** mensagem do sistema — e
não compraria nada: a coluna só serve ao limite de duração e à auditoria, os dois
dentro do escopo da transcrição.

**Esta é a task mais delicada do plano.** Ela toca o caminho quente por onde passa
toda mensagem do sistema, e altera duas regras que a IA já usa. Os dois pontos de
integração abaixo **não quebram nada visivelmente** se ficarem de fora — só fazem a
IA funcionar pior sem ninguém saber.

- [ ] **Step 1: Escrever os testes de `ai.service`**

```js
  test('shouldTranscribe exige canal com IA, transcrição ligada e modelo', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: true, transcriptionModel: 'm' });
    expect(await shouldTranscribe('ch-1')).toBe(true);
  });

  test('shouldTranscribe é false sem IA no canal', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: false });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: true, transcriptionModel: 'm' });
    expect(await shouldTranscribe('ch-1')).toBe(false);
  });

  test('shouldTranscribe é false com transcrição desligada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: false, transcriptionModel: 'm' });
    expect(await shouldTranscribe('ch-1')).toBe(false);
  });

  test('shouldTranscribe é false sem modelo de transcrição', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: true, transcriptionModel: '' });
    expect(await shouldTranscribe('ch-1')).toBe(false);
  });

  test('scheduleTranscription só enfileira áudio, e marca pending com a duração', async () => {
    await scheduleTranscription({ id: 'c-1' }, { id: 'm-1', messageType: 'audio' }, 12);
    expect(markTranscriptionPending).toHaveBeenCalledWith('m-1', 12);
    expect(enqueueTranscription).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: 'm-1' });

    jest.clearAllMocks();
    await scheduleTranscription({ id: 'c-1' }, { id: 'm-2', messageType: 'image' }, null);
    expect(enqueueTranscription).not.toHaveBeenCalled();
  });

  test('sem duração no metadado, enfileira mesmo assim', async () => {
    // O WhatsApp nem sempre manda `seconds`. O limite de tamanho em bytes continua
    // protegendo, então áudio sem duração não pode ser descartado.
    await scheduleTranscription({ id: 'c-1' }, { id: 'm-3', messageType: 'audio' }, null);
    expect(markTranscriptionPending).toHaveBeenCalledWith('m-3', null);
    expect(enqueueTranscription).toHaveBeenCalled();
  });
```

Acrescentar ao topo: `jest.mock('../queue/transcription-queue');` e o mock de
`markTranscriptionPending`.

- [ ] **Step 2: Implementar em `ai.service.js`**

```js
const { enqueueTranscription } = require('../queue/transcription-queue');
const { markTranscriptionPending } = require('../conversations/message.repository');

async function shouldTranscribe(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.aiEnabled) return false;
  const config = await getAiConfig();
  if (!config || !config.transcriptionEnabled) return false;
  if (!config.transcriptionModel) return false;
  return true;
}

async function scheduleTranscription(conversation, message, audioDurationSeconds) {
  if (!message || message.messageType !== 'audio') return;
  // Marca pending já aqui para a tela mostrar "Transcrevendo…" de imediato, em
  // vez de ficar sem sinal até o worker pegar o job. É também onde a duração
  // vinda do Baileys é persistida — ela não passa pelo INSERT de createMessage.
  await markTranscriptionPending(message.id, audioDurationSeconds != null ? audioDurationSeconds : null);
  await enqueueTranscription({ conversationId: conversation.id, messageId: message.id });
}
```

Exportar as duas.

- [ ] **Step 3: Ligar o gancho na ingestão**

Em `src/conversations/inbound-message.service.js`:

1. Acrescentar `audioDurationSeconds` ao objeto desestruturado de
   `ingestInboundMessage` (linha ~19, depois de `locationLongitude`). **Não** o
   repassar a `createMessage` — veja a nota no bloco Interfaces.
2. Trocar o require da linha 11 por
   `const { shouldRunAi, scheduleAiReply, shouldTranscribe, scheduleTranscription } = require('../ai/ai.service');`
3. Inserir o bloco abaixo **antes** do `try` da IA (linha ~115), no mesmo estilo
   try/catch que só loga:

```js
  try {
    if (await shouldTranscribe(channelId)) {
      await scheduleTranscription(conversation, message, audioDurationSeconds);
    }
  } catch (err) {
    console.error(`Failed to schedule transcription for conversation ${conversation.id}`, err);
  }
```

A ordem importa: a transcrição é agendada antes do bloco da IA porque é ela quem
vai disparar o turno de IA do áudio, pelo worker. `scheduleAiReply` continua
ignorando áudio (só aceita `messageType === 'text'`), então não há disparo duplo.

Teste em `inbound-message.service.test.js` (com `shouldTranscribe` devolvendo
`false` no `beforeEach` para não afetar os testes existentes):

```js
  test('agenda transcrição para áudio quando habilitada', async () => {
    const { shouldTranscribe, scheduleTranscription } = require('../ai/ai.service');
    shouldTranscribe.mockResolvedValue(true);

    await ingestInboundMessage({
      channelId, fromPhoneNumber: '5598900003333', contactDisplayName: 'Fulano',
      whatsappMessageId: 'wa-audio-1', messageType: 'audio', content: null,
      mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg',
    });

    expect(scheduleTranscription).toHaveBeenCalled();
  });

  test('transcrição que falha ao agendar nunca bloqueia a ingestão', async () => {
    const { shouldTranscribe } = require('../ai/ai.service');
    shouldTranscribe.mockRejectedValue(new Error('redis fora'));

    const result = await ingestInboundMessage({
      channelId, fromPhoneNumber: '5598900004444', contactDisplayName: 'Fulano',
      whatsappMessageId: 'wa-audio-2', messageType: 'audio', content: null,
      mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg',
    });

    expect(result.message).not.toBeNull();
  });
```

- [ ] **Step 4: PONTO DE INTEGRAÇÃO 1 — a mensagem mais recente utilizável**

`findLatestInboundMessageId` (`message.repository.js:168`) filtra
`message_type = 'text'`. Esse filtro existe para impedir que uma foto enviada
depois de um texto faça a IA desistir de responder. **Com áudio gerando turno de
IA, o id do áudio nunca casaria com "a última mensagem de texto", e todo turno
disparado por áudio desistiria antes de chamar a OpenAI — sem log nenhum.**

Teste primeiro:

```js
  test('áudio transcrito conta como mensagem mais recente utilizável', async () => {
    await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w1',
      status: 'received', messageType: 'text' });
    const audio = await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w2',
      status: 'received', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg' });
    await saveTranscription(audio.id, { transcription: 'falei isso', model: 'm', ms: 5 });

    expect(await findLatestInboundMessageId(conversationId)).toBe(audio.id);
  });

  test('áudio SEM transcrição não conta', async () => {
    const texto = await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w3',
      status: 'received', messageType: 'text' });
    await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w4',
      status: 'received', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg' });

    expect(await findLatestInboundMessageId(conversationId)).toBe(texto.id);
  });

  test('foto continua não contando', async () => {
    const texto = await createMessage({ conversationId, direction: 'inbound', content: 'texto', whatsappMessageId: 'w5',
      status: 'received', messageType: 'text' });
    await createMessage({ conversationId, direction: 'inbound', content: null, whatsappMessageId: 'w6',
      status: 'received', messageType: 'image', mediaPath: 'a.jpg', mediaMimeType: 'image/jpeg' });

    expect(await findLatestInboundMessageId(conversationId)).toBe(texto.id);
  });
```

Depois a implementação:

```js
async function findLatestInboundMessageId(conversationId) {
  // "Utilizável pela IA" = texto, ou áudio já transcrito. Foto e documento
  // continuam de fora: uma foto enviada após um texto não deve fazer a IA
  // desistir de responder ao texto.
  const result = await getPool().query(
    `SELECT id FROM messages
      WHERE conversation_id = $1 AND direction = 'inbound'
        AND (message_type = 'text'
             OR (message_type = 'audio' AND transcription_status = 'completed'))
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].id;
}
```

- [ ] **Step 5: PONTO DE INTEGRAÇÃO 2 — o histórico enviado ao modelo**

`ai-orchestrator.js` (linha ~95) filtra `messageType === 'text' && content`. **Numa
conversa onde o cliente fala por áudio, o modelo veria uma conversa vazia e
responderia sem contexto — parecendo funcionar, só pior.**

Teste primeiro, em `ai-orchestrator.test.js`:

```js
  test('o histórico usa o texto do áudio transcrito', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: null, messageType: 'audio',
        transcription: 'minha internet caiu ontem', transcriptionStatus: 'completed' },
      { direction: 'inbound', content: 'e até agora não voltou', messageType: 'text' },
    ]);
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const { messages } = createChatCompletion.mock.calls[0][0];
    const conteudos = messages.map((m) => m.content).join(' | ');
    expect(conteudos).toContain('minha internet caiu ontem');
    expect(conteudos).toContain('e até agora não voltou');
  });

  test('áudio sem transcrição concluída fica fora do histórico', async () => {
    listRecentMessagesByConversation.mockResolvedValue([
      { direction: 'inbound', content: null, messageType: 'audio',
        transcription: null, transcriptionStatus: 'failed' },
      { direction: 'inbound', content: 'oi', messageType: 'text' },
    ]);
    createChatCompletion.mockResolvedValue({ message: { content: 'ok' }, usage: {} });

    await runAiTurn({ conversation: CONVERSATION, contact: CONTACT });

    const { messages } = createChatCompletion.mock.calls[0][0];
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });
```

Depois a implementação. Substituir o `.filter(...).map(...)` do histórico por:

```js
// Áudio transcrito entra no histórico como o texto da transcrição: para o modelo
// não há diferença entre o cliente ter digitado ou falado. Áudio sem transcrição
// concluída fica de fora — a IA nunca deve receber conteúdo em branco.
function conteudoParaModelo(m) {
  if (m.messageType === 'text') return m.content || null;
  if (m.messageType === 'audio' && m.transcriptionStatus === 'completed') return m.transcription || null;
  return null;
}
```

e no array de `messages`:

```js
    ...historico
      .map((m) => ({ role: papelDaMensagem(m), content: conteudoParaModelo(m) }))
      .filter((m) => m.content),
```

- [ ] **Step 6: Capturar a duração do áudio no Baileys**

Em `baileys.manager.js`, no ramo `audioMessage` de `extractMediaInfo` (linha ~96):

```js
  if (message.audioMessage) {
    return {
      type: 'audio',
      mimeType: message.audioMessage.mimetype,
      caption: null,
      filename: null,
      durationSeconds: message.audioMessage.seconds || null,
    };
  }
```

`audioMessage.seconds` é o campo real do protocolo do WhatsApp — é o mesmo que o
player usa para mostrar a duração antes de baixar o arquivo. Pode vir ausente, e o
`|| null` cobre isso.

E no único ponto onde mídia é ingerida (linha ~316, o `ingestInboundMessage` logo
depois de `saveMediaFile`), acrescentar uma linha depois de `mediaFilename`:

```js
        mediaFilename: mediaInfo.filename,
        audioDurationSeconds: mediaInfo.durationSeconds || null,
```

Só isso. `ingestInboundMessage` já recebe o campo (Step 3) e o entrega a
`scheduleTranscription`, que o grava. **`createMessage` não é tocada.**

Os outros dois `ingestInboundMessage` do arquivo (linhas ~289 e ~331) tratam texto
e localização e não mudam.

- [ ] **Step 7: Suíte completa**

Run: `npm test`
Expected: PASS — esta task toca o caminho quente, então uma regressão apareceria
em várias suítes.

- [ ] **Step 8: Commit**

```bash
git add src/ai/ai.service.js src/conversations/inbound-message.service.js src/conversations/message.repository.js src/ai/ai-orchestrator.js src/whatsapp-adapters/baileys.manager.js src/ai/ai.service.test.js src/conversations/inbound-message.service.test.js src/conversations/message.repository.test.js src/ai/ai-orchestrator.test.js
git commit -m "Feed transcribed audio into the existing AI flow"
```

---

### Task 8: Rotas admin da configuração de transcrição

**Files:**
- Modify: `src/api/admin-ai.routes.js`
- Test: `src/api/admin-ai.routes.test.js`

**Interfaces:**
- Produces: `GET /api/admin/ai/config` passa a devolver os campos de transcrição;
  `PUT /api/admin/ai/transcription` body
  `{ transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds, transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi }`.

Rota separada do `PUT /config` de propósito: os dois cartões da tela salvam
independentemente, e um não deve sobrescrever o outro.

- [ ] **Step 1: Escrever os testes que falham**

```js
  test('GET /config devolve os campos de transcrição', async () => {
    getAiConfig.mockResolvedValue({
      id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'assistant',
      systemPrompt: 'p', maxToolsPerInteraction: 8,
      transcriptionEnabled: true, transcriptionModel: 'modelo-t',
      transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400,
      transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true,
    });
    const res = await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    expect(res.body.transcriptionEnabled).toBe(true);
    expect(res.body.transcriptionModel).toBe('modelo-t');
    expect(JSON.stringify(res.body)).not.toContain('sk-1234567890abcd');
  });

  test('PUT /transcription exige admin', async () => {
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('agent')}`)
      .send({ transcriptionEnabled: false }).expect(403);
  });

  test('PUT /transcription rejeita tipos errados', async () => {
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ transcriptionEnabled: 'sim', transcriptionModel: 'm', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: '', transcriptionFeedAi: true })
      .expect(400);
    expect(updateTranscriptionConfig).not.toHaveBeenCalled();
  });

  test('PUT /transcription exige modelo quando está sendo ligada', async () => {
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ transcriptionEnabled: true, transcriptionModel: '', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: '', transcriptionFeedAi: true })
      .expect(400);
  });

  test('PUT /transcription salva', async () => {
    updateTranscriptionConfig.mockResolvedValue({
      transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
      transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true,
    });
    const res = await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true })
      .expect(200);
    expect(res.body.transcriptionModel).toBe('m');
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/api/admin-ai.routes.test.js`
Expected: FAIL — 404 na rota nova

- [ ] **Step 3: Implementar**

Em `toConfigResponse`, acrescentar os seis campos de transcrição (nunca a chave).

E a rota:

```js
router.put('/transcription', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds,
    transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi,
  } = req.body || {};

  if (typeof transcriptionEnabled !== 'boolean') {
    return res.status(400).json({ error: 'transcriptionEnabled must be a boolean' });
  }
  if (typeof transcriptionFeedAi !== 'boolean') {
    return res.status(400).json({ error: 'transcriptionFeedAi must be a boolean' });
  }
  if (typeof transcriptionModel !== 'string') {
    return res.status(400).json({ error: 'transcriptionModel is required' });
  }
  if (!Number.isInteger(transcriptionMaxSeconds) || transcriptionMaxSeconds <= 0) {
    return res.status(400).json({ error: 'transcriptionMaxSeconds must be a positive integer' });
  }
  if (!Number.isInteger(transcriptionMaxBytes) || transcriptionMaxBytes <= 0) {
    return res.status(400).json({ error: 'transcriptionMaxBytes must be a positive integer' });
  }
  if (typeof transcriptionPrompt !== 'string') {
    return res.status(400).json({ error: 'transcriptionPrompt must be a string' });
  }
  // Ligar sem modelo deixaria a transcrição habilitada e inerte, exatamente o
  // estado que shouldTranscribe recusa em silêncio.
  if (transcriptionEnabled && !transcriptionModel.trim()) {
    return res.status(400).json({ error: 'transcriptionModel is required when transcription is enabled' });
  }

  const config = await updateTranscriptionConfig({
    transcriptionEnabled,
    transcriptionModel: transcriptionModel.trim(),
    transcriptionMaxSeconds,
    transcriptionMaxBytes,
    transcriptionPrompt,
    transcriptionFeedAi,
  });
  res.json(toConfigResponse(config));
});
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/api/admin-ai.routes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/admin-ai.routes.js src/api/admin-ai.routes.test.js
git commit -m "Add admin routes for the transcription settings"
```

---

### Task 9: Cartão de configuração no painel

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/components/AudioTranscriptionConfigCard.jsx`
- Create: `frontend/src/components/AudioTranscriptionConfigCard.test.jsx`
- Modify: `frontend/src/components/IntegrationsAdminTab.jsx`
- Modify: `frontend/src/components/IntegrationsAdminTab.test.jsx`

**Interfaces:**
- Consumes: `GET /api/admin/ai/config`, `PUT /api/admin/ai/transcription`,
  `POST /api/admin/ai/test-connection` (para a lista de modelos).
- Produces: `updateTranscriptionConfig(payload, token)` em `api.js`.

Siga a estrutura de `OpenAiConfigCard.jsx`: mesmas constantes `inputClass`,
`labelClass`, `cardClass`, mesmo padrão de estado local e botão Salvar.

- [ ] **Step 1: Acrescentar a função em `api.js`**

```js
export function updateTranscriptionConfig(payload, token) {
  return apiFetch('/api/admin/ai/transcription', { method: 'PUT', body: payload, token });
}
```

- [ ] **Step 2: Escrever o teste do cartão**

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AudioTranscriptionConfigCard from './AudioTranscriptionConfigCard';

vi.mock('../services/api');
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

import { getAiConfig, updateTranscriptionConfig, testAiConnection } from '../services/api';

describe('AudioTranscriptionConfigCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiConfig.mockResolvedValue({
      configured: true, transcriptionEnabled: false, transcriptionModel: '',
      transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400,
      transcriptionPrompt: 'PPPoE, ONU', transcriptionFeedAi: true,
    });
  });

  test('mostra a duração em minutos e o tamanho em MB', async () => {
    render(<AudioTranscriptionConfigCard />);
    expect(await screen.findByDisplayValue('5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
  });

  test('carrega o vocabulário salvo', async () => {
    render(<AudioTranscriptionConfigCard />);
    expect(await screen.findByDisplayValue('PPPoE, ONU')).toBeInTheDocument();
  });

  test('buscar modelos preenche a lista', async () => {
    testAiConnection.mockResolvedValue({ ok: true, models: ['modelo-a', 'modelo-b'] });
    render(<AudioTranscriptionConfigCard />);
    await userEvent.click(await screen.findByRole('button', { name: /buscar modelos/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'modelo-a' })).toBeInTheDocument());
  });

  test('salvar envia minutos e MB convertidos para segundos e bytes', async () => {
    testAiConnection.mockResolvedValue({ ok: true, models: ['modelo-a'] });
    updateTranscriptionConfig.mockResolvedValue({});
    render(<AudioTranscriptionConfigCard />);

    await userEvent.click(await screen.findByRole('button', { name: /buscar modelos/i }));
    await waitFor(() => screen.getByRole('option', { name: 'modelo-a' }));
    await userEvent.selectOptions(screen.getByLabelText(/modelo/i), 'modelo-a');
    await userEvent.click(screen.getByLabelText(/transcrever áudios/i));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(updateTranscriptionConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionEnabled: true, transcriptionModel: 'modelo-a',
        transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400,
      }),
      't'
    ));
  });

  test('não deixa salvar habilitado sem modelo', async () => {
    render(<AudioTranscriptionConfigCard />);
    await userEvent.click(await screen.findByLabelText(/transcrever áudios/i));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByText(/modelo é obrigatório/i)).toBeInTheDocument();
    expect(updateTranscriptionConfig).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implementar o cartão**

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAiConfig } from '../hooks/useAiConfig';
import { updateTranscriptionConfig, testAiConnection } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

const BYTES_POR_MB = 1048576;

function AudioTranscriptionConfigCard() {
  const { token } = useAuth();
  // `loading` trava o Salvar: antes de a config chegar, o estado guarda os
  // defaults do useState, e um Save nessa janela gravaria defaults por cima dos
  // valores reais — o backend escreve as seis colunas sem COALESCE.
  const { config, loading, refresh } = useAiConfig();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [maxMinutes, setMaxMinutes] = useState(5);
  const [maxMb, setMaxMb] = useState(25);
  const [feedAi, setFeedAi] = useState(true);
  const [vocabulary, setVocabulary] = useState('');
  const [testedModels, setTestedModels] = useState([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A tela trabalha em minutos e MB; o banco guarda segundos e bytes. A conversão
  // acontece só nas duas bordas: aqui ao carregar, e no handleSave ao gravar.
  useEffect(() => {
    setEnabled(Boolean(config.transcriptionEnabled));
    setModel(config.transcriptionModel || '');
    setFeedAi(config.transcriptionFeedAi !== false);
    setVocabulary(config.transcriptionPrompt || '');
    if (config.transcriptionMaxSeconds) setMaxMinutes(Math.round(config.transcriptionMaxSeconds / 60));
    if (config.transcriptionMaxBytes) setMaxMb(Math.round(config.transcriptionMaxBytes / BYTES_POR_MB));
  }, [config]);

  const modelOptions = Array.from(new Set([config.transcriptionModel, model, ...testedModels].filter(Boolean)));

  async function handleFetchModels() {
    setError(null);
    setTesting(true);
    try {
      // A chave já está salva: o backend a lê do banco quando nenhuma é enviada.
      const result = await testAiConnection(undefined, token);
      if (result.ok) setTestedModels(result.models || []);
      else setError(result.error || 'Falha ao buscar modelos');
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao buscar modelos');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    // Ligar sem modelo deixaria a transcrição habilitada e inerte — o mesmo
    // estado que shouldTranscribe recusa em silêncio no backend.
    if (enabled && !model.trim()) {
      setError('Modelo é obrigatório');
      return;
    }
    // Espelha a regra do backend (inteiro positivo). Sem isto, limpar o campo
    // manda Number('') === 0 e o admin vê o erro cru em inglês da API.
    const minutos = Number(maxMinutes);
    const mb = Number(maxMb);
    if (!Number.isInteger(minutos) || minutos < 1 || !Number.isInteger(mb) || mb < 1) {
      setError('Duração e tamanho máximos devem ser números inteiros maiores que zero');
      return;
    }
    setSaving(true);
    try {
      await updateTranscriptionConfig(
        {
          transcriptionEnabled: enabled,
          transcriptionModel: model.trim(),
          transcriptionMaxSeconds: minutos * 60,
          transcriptionMaxBytes: mb * BYTES_POR_MB,
          transcriptionPrompt: vocabulary,
          transcriptionFeedAi: feedAi,
        },
        token
      );
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Transcrição de áudio</h3>
      <p className="text-sm text-wa-muted">
        Converte os áudios recebidos em texto e entrega o texto à IA, que responde como se o
        cliente tivesse digitado.
      </p>

      <label className="flex items-center gap-2 text-sm text-wa-text">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Transcrever áudios automaticamente
      </label>

      <div>
        <label htmlFor="transcription-model" className={labelClass}>Modelo</label>
        <select
          id="transcription-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        >
          <option value="">Selecione um modelo</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="transcription-max-minutes" className={labelClass}>Duração máxima (minutos)</label>
          <input
            id="transcription-max-minutes"
            type="number"
            min="1"
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="transcription-max-mb" className={labelClass}>Tamanho máximo (MB)</label>
          <input
            id="transcription-max-mb"
            type="number"
            min="1"
            value={maxMb}
            onChange={(e) => setMaxMb(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-wa-text">
        <input type="checkbox" checked={feedAi} onChange={(e) => setFeedAi(e.target.checked)} />
        Enviar transcrição para a IA
      </label>

      <div>
        <label htmlFor="transcription-vocabulary" className={labelClass}>Vocabulário da operação</label>
        <textarea
          id="transcription-vocabulary"
          rows={3}
          value={vocabulary}
          onChange={(e) => setVocabulary(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-wa-muted">
          Termos que o modelo costuma errar: nomes técnicos, marcas, jargão da operação.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={testing}
          className="rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm font-medium text-wa-text transition hover:bg-wa-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          Buscar modelos
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </form>
  );
}

export default AudioTranscriptionConfigCard;
```

- [ ] **Step 4: Montar em `IntegrationsAdminTab.jsx`**

Renderizar `<AudioTranscriptionConfigCard />` depois de `<OpenAiConfigCard />` e
antes de `<AiToolPermissionsCard />`.

**Atenção:** montar um cartão novo que chama `getAiConfig` quebra os testes
existentes daquele arquivo se o mock não resolver. Acrescentar ao `beforeEach` de
`IntegrationsAdminTab.test.jsx` o que faltar — é conserto, não afrouxamento.

- [ ] **Step 5: Rodar os testes do frontend**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/api.js frontend/src/components/AudioTranscriptionConfigCard.jsx frontend/src/components/AudioTranscriptionConfigCard.test.jsx frontend/src/components/IntegrationsAdminTab.jsx frontend/src/components/IntegrationsAdminTab.test.jsx
git commit -m "Add the audio transcription settings card"
```

---

### Task 10: Exibição da transcrição na conversa

**Files:**
- Modify: `frontend/src/components/MessageAttachment.jsx`
- Test: `frontend/src/components/MessageAttachment.test.jsx`
- Modify: `frontend/src/hooks/useConversationMessages.js`
- Test: `frontend/src/hooks/useConversationMessages.test.jsx`

**Interfaces:**
- Consumes: o evento de socket `message:transcription` com
  `{ conversationId, messageId, transcription, transcriptionStatus, transcriptionDetail }`.

**O player não muda.** A transcrição aparece **abaixo** dele. O atendente deve
continuar podendo ouvir o áudio original em todos os estados.

- [ ] **Step 1: Escrever os testes que falham**

```jsx
  test('áudio sem transcrição renderiza só o player', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg' }} />);
    expect(container.querySelector('audio')).toBeInTheDocument();
    expect(screen.queryByText(/transcrição por ia/i)).not.toBeInTheDocument();
  });

  test('mostra Transcrevendo enquanto processa', () => {
    render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'processing' }} />);
    expect(screen.getByText(/transcrevendo/i)).toBeInTheDocument();
  });

  test('mostra o texto e o rótulo quando concluída, sem tirar o player', () => {
    const { container } = render(<MessageAttachment message={{
      id: 'm1', messageType: 'audio', mediaPath: 'a.ogg',
      transcriptionStatus: 'completed', transcription: 'minha internet caiu',
    }} />);
    expect(screen.getByText(/transcrição por ia/i)).toBeInTheDocument();
    expect(screen.getByText('minha internet caiu')).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  test('mostra aviso na falha', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'failed' }} />);
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  test('mostra aviso quando pulada por limite', () => {
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'skipped' }} />);
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
  });

  test('o player sobrevive ao estado de processamento', () => {
    // O atendente precisa poder ouvir o áudio enquanto a máquina ainda transcreve.
    const { container } = render(<MessageAttachment message={{ id: 'm1', messageType: 'audio', mediaPath: 'a.ogg', transcriptionStatus: 'processing' }} />);
    expect(container.querySelector('audio')).toBeInTheDocument();
  });
```

E no hook, seguindo o `createFakeSocket()` que o arquivo já define:

```jsx
  test('message:transcription preenche a transcrição da mensagem', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1',
        messageId: 'm1',
        transcription: 'minha internet caiu',
        transcriptionStatus: 'completed',
        transcriptionDetail: null,
      });
    });

    expect(result.current.messages[0].transcription).toBe('minha internet caiu');
    expect(result.current.messages[0].transcriptionStatus).toBe('completed');
    expect(result.current.messages[0].messageType).toBe('audio');
  });

  test('message:transcription de outra conversa é ignorado', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio', transcriptionStatus: 'pending' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-2', messageId: 'm1',
        transcription: 'texto errado', transcriptionStatus: 'completed', transcriptionDetail: null,
      });
    });

    expect(result.current.messages[0].transcription).toBeUndefined();
  });

  test('message:transcription para mensagem desconhecida não quebra a lista', async () => {
    api.getMessages.mockResolvedValue([{ id: 'm1', messageType: 'audio' }]);
    const { result } = renderHook(() => useConversationMessages('conv-1'));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    act(() => {
      fakeSocket.trigger('message:transcription', {
        conversationId: 'conv-1', messageId: 'm-inexistente',
        transcription: 'x', transcriptionStatus: 'completed', transcriptionDetail: null,
      });
    });

    expect(result.current.messages).toHaveLength(1);
  });
```

O terceiro teste importa: o worker emite pelo `messageId`, e a tela do atendente
pode estar noutra conversa ou ter recarregado. O evento não pode inventar mensagem.

- [ ] **Step 2: Implementar no `MessageAttachment.jsx`**

Trocar o retorno do ramo de áudio por um fragmento que mantém o `VoiceNote` e
acrescenta o bloco de transcrição:

```jsx
  if (message.messageType === 'audio') {
    return (
      <div className="flex flex-col gap-1.5">
        <VoiceNote url={url} seed={message.id || ''} outbound={outbound} avatar={avatar} dark={dark} />
        <TranscriptionBlock message={message} dark={dark} />
      </div>
    );
  }
```

E o componente novo, no mesmo arquivo:

```jsx
function TranscriptionBlock({ message, dark }) {
  const status = message.transcriptionStatus;
  if (!status) return null;

  const base = 'rounded-xl px-3 py-2 text-sm';
  const muted = dark ? 'text-wa-muted' : 'text-gray-500';

  if (status === 'pending' || status === 'processing') {
    return <p className={`${base} ${muted} italic`}>Transcrevendo…</p>;
  }
  // 'skipped' cobre mais de um motivo (duração, tamanho, formato não suportado),
  // por isso a frase é única e o detalhe técnico fica só no banco — o atendente
  // precisa saber que não há texto, não por que o modelo recusou.
  if (status === 'failed' || status === 'skipped') {
    return <p className={`${base} ${muted}`}>Não foi possível transcrever este áudio.</p>;
  }
  return (
    <div className={`${base} ${dark ? 'bg-wa-field' : 'bg-gray-100'}`}>
      <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${muted}`}>Transcrição por IA</p>
      <p className="whitespace-pre-wrap">{message.transcription}</p>
    </div>
  );
}
```

O rótulo **Transcrição por IA** é fixo e sempre visível quando há texto: o
atendente nunca deve confundir o que a máquina ouviu com o que o cliente escreveu.

- [ ] **Step 3: Ligar o evento de socket no hook**

Em `useConversationMessages.js`, dentro do `useEffect` que já registra `onNew` e
`onUpdated` (linha ~17), seguindo o mesmo estilo (`prev`, não `atuais`):

```js
    function onTranscription({ conversationId: msgConversationId, messageId, transcription, transcriptionStatus, transcriptionDetail }) {
      if (msgConversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, transcription, transcriptionStatus, transcriptionDetail } : m
        )
      );
    }
```

E nas duas listas do mesmo efeito:

```js
    socket.on('message:transcription', onTranscription);
    return () => {
      ...
      socket.off('message:transcription', onTranscription);
    };
```

O `map` só reescreve a mensagem com o id correspondente, então um evento de
mensagem que não está na lista passa sem efeito — é o terceiro teste do Step 1.

- [ ] **Step 4: Rodar os testes do frontend**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageAttachment.jsx frontend/src/components/MessageAttachment.test.jsx frontend/src/hooks/useConversationMessages.js frontend/src/hooks/useConversationMessages.test.jsx
git commit -m "Show the AI transcription under the audio player"
```

---

### Task 11: Verificação ponta a ponta

**Files:** nenhum. Execução manual contra a OpenAI e o WhatsApp reais.

- [ ] **Step 1: Suítes completas**

Run: `npm test && cd frontend && npm test`
Expected: PASS nas duas.

- [ ] **Step 2: Confirmar que o deploy é inerte**

Com `transcription_enabled = false`, mandar um áudio pelo WhatsApp num canal com
IA ligada. Esperado: áudio entra e toca normalmente; **nenhuma** linha com
`transcription_status` preenchido.

```sql
SELECT count(*) FROM messages WHERE transcription_status IS NOT NULL;
```
Esperado: `0`.

- [ ] **Step 3: Configurar**

Painel → Integrações → Transcrição de áudio: ligar, escolher o modelo pela lista
do botão "Buscar modelos", deixar 5 minutos e 25 MB, manter "Enviar transcrição
para a IA" ligado, salvar.

- [ ] **Step 4: Os cenários obrigatórios**

Com a conversa atribuída a você, mandar áudio dizendo cada frase:

| # | Áudio | Esperado |
|---|---|---|
| 1 | "Bom dia" (curto, ~3s) | transcreve; IA responde |
| 2 | "Minha internet está lenta" | transcrição correta; IA consulta contrato e conexão |
| 3 | "Estou sem internet" | idem |
| 4 | "Tenho uma fatura atrasada?" | IA consulta financeiro |
| 5 | "Quero falar com atendente" | IA oferece transferir |
| 6 | Termos técnicos: "PPPoE", "ONU", "DW Telecom", "segunda via", "PIX" | conferir se o vocabulário ajudou a grafia |
| 7 | Áudio de ~1 minuto | transcreve inteiro |
| 8 | Áudio acima de 5 minutos | `skipped`, player preservado, IA não acionada |
| 9 | Dois áudios seguidos | **os dois** transcritos; IA responde ao último |
| 10 | Áudio + foto em seguida | a foto não impede a IA de responder ao áudio |
| 11 | Áudio com ruído/inaudível | `failed` ou texto ruim, **nunca** resposta inventada |
| 12 | Desligar "Enviar transcrição para a IA" e mandar áudio | transcreve e mostra, mas nenhuma sugestão de IA |

- [ ] **Step 5: Conferir a auditoria**

```sql
SELECT transcription_status, count(*), round(avg(transcription_ms)) AS ms_medio,
       sum(audio_duration_seconds) AS segundos_processados
  FROM messages WHERE transcription_status IS NOT NULL
 GROUP BY transcription_status;
```

E confirmar que nenhum caminho gravou segredo:

```sql
SELECT count(*) FROM messages
 WHERE transcription_detail ILIKE '%sk-%' OR transcription_detail ILIKE '%token%';
```
Esperado: `0`.

- [ ] **Step 6: Desligar e confirmar que volta ao normal**

Desmarcar "Transcrever áudios", mandar áudio. Esperado: nenhuma transcrição nova,
áudio funcionando como antes.

- [ ] **Step 7: Push**

```bash
git push -u origin audio-transcription
```

---

## Cobertura da spec

| Seção da spec | Task |
|---|---|
| Modelo de dados (messages + ai_config) | 1 |
| Armadilha das colunas enumeradas | 2 |
| Configuração de transcrição | 3 |
| `transcribeAudio` | 4 |
| `transcription.service` (validação de MIME, limites, falhas) | 5 |
| Fila e worker próprios | 6 |
| Gancho na ingestão | 7 |
| **Ponto de integração 1** (mensagem mais recente utilizável) | 7 (Step 4) |
| **Ponto de integração 2** (histórico do modelo) | 7 (Step 5) |
| Duração vinda do metadado do Baileys | 7 (Step 6) |
| Rotas admin | 8 |
| Cartão de configuração + vocabulário | 9 |
| Exibição na conversa + socket | 10 |
| Segurança (chave só no cabeçalho, erro saneado) | 4, 5 |
| Deploy inerte | 1 (default false), 11 (Step 2) |
| Cenários manuais | 11 |
| Fora de escopo (dashboard, conversão de formato, áudio do atendente, sob demanda, reprocessar) | não implementado, por decisão |
