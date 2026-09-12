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

  test('creating a new suggestion discards the conversation\'s previous pending ones, leaving exactly one pending', async () => {
    // Real sequence this guards against: customer writes -> AI drafts A (pending);
    // attendant does nothing; customer writes again -> AI drafts B. Without this,
    // A stays 'pending' forever and resurfaces on the next load, answering a
    // message that was already handled by B.
    const antiga = await createSuggestion({ conversationId, messageId: null, content: 'draft A' });
    const nova = await createSuggestion({ conversationId, messageId: null, content: 'draft B' });

    const pendentes = await getPool().query(
      "SELECT id FROM ai_suggestions WHERE conversation_id = $1 AND status = 'pending'",
      [conversationId]
    );
    expect(pendentes.rows).toHaveLength(1);
    expect(pendentes.rows[0].id).toBe(nova.id);

    const antigaAtualizada = await getPool().query('SELECT status FROM ai_suggestions WHERE id = $1', [antiga.id]);
    expect(antigaAtualizada.rows[0].status).toBe('discarded');
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
