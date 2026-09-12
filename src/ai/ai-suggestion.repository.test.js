const { getPool, closePool } = require('../db/pool');
const { createSuggestion, findPendingSuggestion, markSuggestion } = require('./ai-suggestion.repository');

describe('ai suggestion repository', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_suggestions, conversations, contacts, channels CASCADE');
    const ch = await getPool().query("INSERT INTO channels (type, name, status) VALUES ('baileys','C','connected') RETURNING id");
    const ct = await getPool().query("INSERT INTO contacts (phone_number) VALUES ('5598900000001') RETURNING id");
    const cv = await getPool().query('INSERT INTO conversations (contact_id, channel_id) VALUES ($1,$2) RETURNING id', [ct.rows[0].id, ch.rows[0].id]);
    conversationId = cv.rows[0].id;
  });

  afterAll(async () => { await closePool(); });

  test('creates a pending suggestion and finds it back', async () => {
    const created = await createSuggestion({ conversationId, messageId: null, content: 'Seu plano é 600MB.' });
    expect(created.status).toBe('pending');
    const found = await findPendingSuggestion(conversationId);
    expect(found.id).toBe(created.id);
  });

  test('a marked suggestion is no longer pending', async () => {
    const created = await createSuggestion({ conversationId, messageId: null, content: 'x' });
    await markSuggestion(created.id, 'sent');
    expect(await findPendingSuggestion(conversationId)).toBeNull();
  });

  test('findPendingSuggestion returns the newest one when there is more than one', async () => {
    await createSuggestion({ conversationId, messageId: null, content: 'antiga' });
    const nova = await createSuggestion({ conversationId, messageId: null, content: 'nova' });
    const found = await findPendingSuggestion(conversationId);
    expect(found.id).toBe(nova.id);
  });

  test('markSuggestion returns null for an unknown id', async () => {
    expect(await markSuggestion('00000000-0000-0000-0000-000000000000', 'sent')).toBeNull();
  });

  test('markSuggestion on an already-marked suggestion returns null instead of marking it again', async () => {
    // Guards against a double-send: two concurrent requests for the same suggestion must not
    // both succeed. An unconditional `UPDATE ... WHERE id = $1` would happily match and update
    // the row a second time (this assertion would then see the 'sent' object, not null).
    const created = await createSuggestion({ conversationId, messageId: null, content: 'x' });
    const first = await markSuggestion(created.id, 'sent');
    expect(first.status).toBe('sent');

    const second = await markSuggestion(created.id, 'sent');
    expect(second).toBeNull();
  });
});
