const { getPool, closePool } = require('../db/pool');
const {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  findChannelByWabaId,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
  updateChannelWabaId,
} = require('./channel.repository');

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

  test('listChannels returns an empty array when there are no channels', async () => {
    const channels = await listChannels();
    expect(channels).toEqual([]);
  });

  test('listChannels returns all channels ordered by creation time', async () => {
    const first = await createChannel({
      type: 'meta_cloud',
      name: 'Primeiro Canal',
      phoneNumber: '+5511999990010',
      config: { phoneNumberId: '1', accessToken: 'a' },
    });
    const second = await createChannel({
      type: 'baileys',
      name: 'Segundo Canal',
      phoneNumber: '+5511999990011',
      config: {},
    });

    const channels = await listChannels();

    expect(channels.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  test('updateChannelStatus updates and returns the channel with the new status', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Baileys',
      phoneNumber: '+5511999990012',
      config: {},
    });
    expect(channel.status).toBe('disconnected');

    const updated = await updateChannelStatus(channel.id, 'awaiting_qr');

    expect(updated.status).toBe('awaiting_qr');
    expect(updated.id).toBe(channel.id);
  });

  test('updateChannelStatus returns null when the channel does not exist', async () => {
    const updated = await updateChannelStatus('00000000-0000-0000-0000-000000000000', 'connected');
    expect(updated).toBeNull();
  });

  test('createChannel defaults triageEnabled to false', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Sem Triagem',
      phoneNumber: '+5511999990020',
      config: {},
    });
    expect(channel.triageEnabled).toBe(false);
  });

  test('updateChannelTriageEnabled turns triage on and off', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Com Triagem',
      phoneNumber: '+5511999990021',
      config: {},
    });

    const enabled = await updateChannelTriageEnabled(channel.id, true);
    expect(enabled.triageEnabled).toBe(true);

    const disabled = await updateChannelTriageEnabled(channel.id, false);
    expect(disabled.triageEnabled).toBe(false);
  });

  test('updateChannelTriageEnabled returns null when the channel does not exist', async () => {
    const result = await updateChannelTriageEnabled('00000000-0000-0000-0000-000000000000', true);
    expect(result).toBeNull();
  });
});

describe('findChannelByWabaId', () => {
  test('finds a meta_cloud channel by its configured wabaId', async () => {
    const created = await createChannel({
      type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '1234567890', accessToken: 'tok', wabaId: 'waba-abc' },
    });
    const found = await findChannelByWabaId('waba-abc');
    expect(found.id).toBe(created.id);
  });

  test('returns null when no channel has that wabaId', async () => {
    expect(await findChannelByWabaId('does-not-exist')).toBeNull();
  });

  test('never matches a baileys channel', async () => {
    await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5511999991111', config: {} });
    expect(await findChannelByWabaId(undefined)).toBeNull();
  });
});

describe('updateChannelWabaId', () => {
  test('updates the wabaId of an existing meta_cloud channel', async () => {
    const created = await createChannel({
      type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999992222',
      config: { phoneNumberId: '1234567890', accessToken: 'tok', wabaId: 'old-waba' },
    });
    const updated = await updateChannelWabaId(created.id, 'new-waba');
    expect(updated.config.wabaId).toBe('new-waba');
    expect(updated.config.phoneNumberId).toBe('1234567890');
  });

  test('returns null for a baileys channel', async () => {
    const created = await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5511999993333', config: {} });
    expect(await updateChannelWabaId(created.id, 'waba-x')).toBeNull();
  });

  test('returns null for a non-existent id', async () => {
    expect(await updateChannelWabaId('00000000-0000-0000-0000-000000000000', 'waba-x')).toBeNull();
  });
});
