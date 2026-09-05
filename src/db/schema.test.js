const { getPool, closePool } = require('./pool');

describe('database schema', () => {
  afterAll(async () => {
    await closePool();
  });

  const tables = ['agents', 'channels', 'contacts', 'conversations', 'messages', 'conversation_events'];

  test.each(tables)('table %s exists', async (tableName) => {
    const pool = getPool();
    const result = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_name = $1',
      [tableName]
    );
    expect(result.rowCount).toBe(1);
  });

  test('conversations has a unique index for open conversations per contact/channel', async () => {
    const pool = getPool();
    const result = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'conversations' AND indexname = 'conversations_open_per_contact_channel'"
    );
    expect(result.rowCount).toBe(1);
  });

  test('channels has a phone_number column', async () => {
    const pool = getPool();
    const result = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'channels' AND column_name = 'phone_number'"
    );
    expect(result.rowCount).toBe(1);
  });

  test.each([
    'channels_phone_number_unique',
    'messages_conversation_id_created_at_idx',
    'conversations_status_idx',
    'conversations_assigned_agent_id_idx',
  ])('index %s exists', async (indexName) => {
    const pool = getPool();
    const result = await pool.query('SELECT indexname FROM pg_indexes WHERE indexname = $1', [indexName]);
    expect(result.rowCount).toBe(1);
  });
});
