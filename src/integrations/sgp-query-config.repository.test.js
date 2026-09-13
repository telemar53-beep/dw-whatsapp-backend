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

  test('os dados do recebedor Pix voltam null quando nunca foram gravados', async () => {
    const config = await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true });
    expect(config.pixMerchantName).toBeNull();
    expect(config.pixMerchantKey).toBeNull();
    expect(config.pixMerchantKeyType).toBeNull();
  });

  test('upsertSgpQueryConfig grava e devolve o recebedor Pix', async () => {
    const config = await upsertSgpQueryConfig({
      baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true,
      pixMerchantName: 'DW TELECOM LTDA', pixMerchantKey: '12345678000199', pixMerchantKeyType: 'CNPJ',
    });
    expect(config.pixMerchantName).toBe('DW TELECOM LTDA');
    expect(config.pixMerchantKey).toBe('12345678000199');
    expect(config.pixMerchantKeyType).toBe('CNPJ');

    const fetched = await getSgpQueryConfig();
    expect(fetched.pixMerchantName).toBe('DW TELECOM LTDA');
    expect(fetched.pixMerchantKey).toBe('12345678000199');
    expect(fetched.pixMerchantKeyType).toBe('CNPJ');
  });

  test('undefined mantém o recebedor Pix que já estava gravado', async () => {
    await upsertSgpQueryConfig({
      baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true,
      pixMerchantName: 'DW TELECOM LTDA', pixMerchantKey: '12345678000199', pixMerchantKeyType: 'CNPJ',
    });
    const updated = await upsertSgpQueryConfig({ baseUrl: 'https://b.example', app: 'chatmix', token: null, enabled: true });
    expect(updated.pixMerchantName).toBe('DW TELECOM LTDA');
    expect(updated.pixMerchantKey).toBe('12345678000199');
    expect(updated.pixMerchantKeyType).toBe('CNPJ');
  });

  test('null apaga o recebedor Pix gravado', async () => {
    await upsertSgpQueryConfig({
      baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true,
      pixMerchantName: 'DW TELECOM LTDA', pixMerchantKey: '12345678000199', pixMerchantKeyType: 'CNPJ',
    });
    const updated = await upsertSgpQueryConfig({
      baseUrl: 'https://a.example', app: 'chatmix', token: null, enabled: true,
      pixMerchantName: null, pixMerchantKey: null, pixMerchantKeyType: null,
    });
    expect(updated.pixMerchantName).toBeNull();
    expect(updated.pixMerchantKey).toBeNull();
    expect(updated.pixMerchantKeyType).toBeNull();
  });

  test('upsertSgpQueryConfig keeps the existing token when a falsy token is passed', async () => {
    await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: 'tok-1', enabled: true });
    const updated = await upsertSgpQueryConfig({ baseUrl: 'https://a.example', app: 'chatmix', token: null, enabled: true });

    expect(updated.token).toBe('tok-1');
  });
});
