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
});
