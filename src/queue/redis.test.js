const { getRedisClient, closeRedisClient } = require('./redis');

describe('getRedisClient', () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  test('connects to redis and can set/get a value', async () => {
    const client = getRedisClient();
    await client.set('plan2-test-key', 'test-value');
    const value = await client.get('plan2-test-key');
    expect(value).toBe('test-value');
  });

  test('returns the same client instance on repeated calls', () => {
    const first = getRedisClient();
    const second = getRedisClient();
    expect(first).toBe(second);
  });
});
