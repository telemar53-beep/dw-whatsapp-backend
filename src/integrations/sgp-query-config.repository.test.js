const { getPool, closePool } = require('../db/pool');
const { getSgpQueryConfig, upsertSgpQueryConfig } = require('./sgp-query-config.repository');

describe('sgp query config repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE sgp_query_config');
  });

  afterAll(async () => {
    await closePool();
  });

  test('getSgpQueryConfig returns null when nothing is configured', async () => {
    expect(await getSgpQueryConfig()).toBeNull();
  });

  test('upsertSgpQueryConfig creates the row on first save', async () => {
    const config = await upsertSgpQueryConfig({
      baseUrl: 'https://dwtelecom.sgp.tsmx.com.br',
      app: 'chatmix',
      token: 'secret-token',
      enabled: true,
    });
    expect(config.baseUrl).toBe('https://dwtelecom.sgp.tsmx.com.br');
    expect(config.app).toBe('chatmix');
    expect(config.token).toBe('secret-token');
    expect(config.enabled).toBe(true);

    const fetched = await getSgpQueryConfig();
    expect(fetched.id).toBe(config.id);
  });

  test('upsertSgpQueryConfig updates the existing row instead of creating a second one', async () => {
    await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true });
    const updated = await upsertSgpQueryConfig({ baseUrl: 'https://b.example', app: 'chatmix', token: 'tok-2', enabled: false });

    expect(updated.baseUrl).toBe('https://b.example');
    expect(updated.token).toBe('tok-2');
    expect(updated.enabled).toBe(false);

    const all = await getPool().query('SELECT id FROM sgp_query_config');
    expect(all.rowCount).toBe(1);
  });

  test('upsertSgpQueryConfig keeps the existing token when a falsy token is passed', async () => {
    await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true });
    const updated = await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: null, enabled: true });

    expect(updated.token).toBe('tok-1');
  });
});
