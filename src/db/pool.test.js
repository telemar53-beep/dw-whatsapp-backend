const { getPool, closePool, withTransaction } = require('./pool');
const { createChannel } = require('../channels/channel.repository');

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

describe('withTransaction', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('commits all writes when the callback succeeds', async () => {
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Tx Test',
      phoneNumber: '+5511999990030',
      config: {},
    });
    await withTransaction(async (client) => {
      await client.query("UPDATE channels SET status = 'connected' WHERE id = $1", [channel.id]);
    });
    const result = await getPool().query('SELECT status FROM channels WHERE id = $1', [channel.id]);
    expect(result.rows[0].status).toBe('connected');
  });

  test('rolls back all writes when the callback throws', async () => {
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Tx Test 2',
      phoneNumber: '+5511999990031',
      config: {},
    });
    await expect(
      withTransaction(async (client) => {
        await client.query("UPDATE channels SET status = 'connected' WHERE id = $1", [channel.id]);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const result = await getPool().query('SELECT status FROM channels WHERE id = $1', [channel.id]);
    expect(result.rows[0].status).toBe('disconnected');
  });
});
