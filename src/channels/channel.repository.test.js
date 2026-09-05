const { getPool, closePool } = require('../db/pool');
const { createChannel, findChannelById, findChannelByMetaPhoneNumberId } = require('./channel.repository');

describe('channel repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createChannel stores and returns a meta_cloud channel', async () => {
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Suporte Principal',
      phoneNumber: '+5511999990001',
      config: { phoneNumberId: '1234567890', accessToken: 'token-abc' },
    });
    expect(channel.id).toBeDefined();
    expect(channel.type).toBe('meta_cloud');
    expect(channel.phoneNumber).toBe('+5511999990001');
    expect(channel.config).toEqual({ phoneNumberId: '1234567890', accessToken: 'token-abc' });
  });

  test('findChannelById returns null when not found', async () => {
    const channel = await findChannelById('00000000-0000-0000-0000-000000000000');
    expect(channel).toBeNull();
  });

  test('findChannelByMetaPhoneNumberId finds a channel by its Meta phone_number_id', async () => {
    await createChannel({
      type: 'meta_cloud',
      name: 'Suporte Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '9999999999', accessToken: 'token-xyz' },
    });
    const channel = await findChannelByMetaPhoneNumberId('9999999999');
    expect(channel.name).toBe('Suporte Financeiro');
  });

  test('findChannelByMetaPhoneNumberId returns null when not found', async () => {
    const channel = await findChannelByMetaPhoneNumberId('does-not-exist');
    expect(channel).toBeNull();
  });
});
