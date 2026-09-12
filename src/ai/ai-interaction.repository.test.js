const { getPool, closePool } = require('../db/pool');
const { recordAiInteraction, listAiInteractionsByConversation } = require('./ai-interaction.repository');

describe('ai interaction repository', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_interactions, conversations, contacts, channels CASCADE');
    const channel = await getPool().query(
      "INSERT INTO channels (type, name, status) VALUES ('baileys', 'C', 'connected') RETURNING id"
    );
    const contact = await getPool().query(
      "INSERT INTO contacts (phone_number) VALUES ('5598999990000') RETURNING id"
    );
    const conversation = await getPool().query(
      'INSERT INTO conversations (contact_id, channel_id) VALUES ($1, $2) RETURNING id',
      [contact.rows[0].id, channel.rows[0].id]
    );
    conversationId = conversation.rows[0].id;
  });

  afterAll(async () => { await closePool(); });

  test('records an interaction and reads it back', async () => {
    await recordAiInteraction({
      conversationId, contactId: null, mode: 'assistant', model: 'gpt-x',
      toolsRequested: [{ nome: 'consultar_plano' }],
      toolsExecuted: [{ nome: 'consultar_plano', ok: true }],
      toolsRefused: [],
      finalResponse: 'Seu plano é 600MB.', error: null,
      promptTokens: 120, completionTokens: 35, durationMs: 1840,
    });

    const rows = await listAiInteractionsByConversation(conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('gpt-x');
    expect(rows[0].toolsRequested).toEqual([{ nome: 'consultar_plano' }]);
    expect(rows[0].promptTokens).toBe(120);
  });

  test('records a failed interaction with the error and no response', async () => {
    await recordAiInteraction({
      conversationId, contactId: null, mode: 'assistant', model: 'gpt-x',
      toolsRequested: [], toolsExecuted: [], toolsRefused: [{ nome: 'consultar_ip', motivo: 'unknown_tool' }],
      finalResponse: null, error: 'timeout', promptTokens: null, completionTokens: null, durationMs: 15000,
    });

    const rows = await listAiInteractionsByConversation(conversationId);
    expect(rows[0].error).toBe('timeout');
    expect(rows[0].toolsRefused[0].motivo).toBe('unknown_tool');
  });

  test('preserves zero values for numeric fields (completion_tokens and duration_ms)', async () => {
    await recordAiInteraction({
      conversationId, contactId: null, mode: 'assistant', model: 'gpt-x',
      toolsRequested: [], toolsExecuted: [], toolsRefused: [],
      finalResponse: null, error: null,
      promptTokens: 50, completionTokens: 0, durationMs: 0,
    });

    const rows = await listAiInteractionsByConversation(conversationId);
    expect(rows[0].completionTokens).toBe(0);
    expect(rows[0].durationMs).toBe(0);
  });

  test('records omitted numeric fields as null', async () => {
    await recordAiInteraction({
      conversationId, contactId: null, mode: 'assistant', model: 'gpt-x',
      toolsRequested: [], toolsExecuted: [], toolsRefused: [],
      finalResponse: null, error: null,
    });

    const rows = await listAiInteractionsByConversation(conversationId);
    expect(rows[0].promptTokens).toBe(null);
    expect(rows[0].completionTokens).toBe(null);
    expect(rows[0].durationMs).toBe(null);
  });
});
