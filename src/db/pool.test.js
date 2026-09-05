const { getPool, closePool } = require('./pool');

describe('getPool', () => {
  afterAll(async () => {
    await closePool();
  });

  test('connects to postgres and runs a query', async () => {
    const pool = getPool();
    const result = await pool.query('SELECT 1 AS value');
    expect(result.rows[0].value).toBe(1);
  });

  test('returns the same pool instance on repeated calls', () => {
    const first = getPool();
    const second = getPool();
    expect(first).toBe(second);
  });
});
