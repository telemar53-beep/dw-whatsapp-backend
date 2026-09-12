const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  findChannelByWabaId,
  findChannelByWebhookToken,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  countChannelDependents,
  deleteChannel,
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

  test('createChannel defaults welcomeMessage to null', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Sem Boas-Vindas',
      phoneNumber: '+5511999990022',
      config: {},
    });
    expect(channel.welcomeMessage).toBeNull();
  });

  test('updateChannelWelcomeMessage sets and clears the welcome message', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Com Boas-Vindas',
      phoneNumber: '+5511999990023',
      config: {},
    });

    const withMessage = await updateChannelWelcomeMessage(channel.id, 'Olá! Bem-vindo.');
    expect(withMessage.welcomeMessage).toBe('Olá! Bem-vindo.');

    const cleared = await updateChannelWelcomeMessage(channel.id, null);
    expect(cleared.welcomeMessage).toBeNull();
  });

  test('updateChannelWelcomeMessage returns null when the channel does not exist', async () => {
    const result = await updateChannelWelcomeMessage('00000000-0000-0000-0000-000000000000', 'Oi');
    expect(result).toBeNull();
  });

  test('findChannelById includes welcomeMessage', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Buscavel',
      phoneNumber: '+5511999990024',
      config: {},
    });
    await updateChannelWelcomeMessage(channel.id, 'Seja bem-vindo!');

    const found = await findChannelById(channel.id);
    expect(found.welcomeMessage).toBe('Seja bem-vindo!');
  });

  test('createChannel defaults aiEnabled to false, and findChannelById reads it back after a direct update', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal Com IA',
      phoneNumber: '+5511999990025',
      config: {},
    });
    expect(channel.aiEnabled).toBe(false);

    await getPool().query('UPDATE channels SET ai_enabled = true WHERE id = $1', [channel.id]);

    const found = await findChannelById(channel.id);
    expect(found.aiEnabled).toBe(true);
  });

  test('createChannel stores and returns a 360dialog channel', async () => {
    const channel = await createChannel({
      type: '360dialog',
      name: 'Suporte via BSP',
      phoneNumber: '+5511999990003',
      config: { apiKey: 'd360-key-abc', wabaId: 'waba-360-1', webhookToken: 'token-abc123' },
    });
    expect(channel.id).toBeDefined();
    expect(channel.type).toBe('360dialog');
    expect(channel.config).toEqual({ apiKey: 'd360-key-abc', wabaId: 'waba-360-1', webhookToken: 'token-abc123' });
  });

  describe('findChannelByWebhookToken', () => {
    test('finds a 360dialog channel by its webhookToken', async () => {
      const created = await createChannel({
        type: '360dialog', name: 'Suporte via BSP', phoneNumber: '+5511999990004',
        config: { apiKey: 'key-1', wabaId: 'waba-1', webhookToken: 'find-me-token' },
      });
      const found = await findChannelByWebhookToken('find-me-token');
      expect(found.id).toBe(created.id);
    });

    test('returns null when no channel has that token', async () => {
      expect(await findChannelByWebhookToken('does-not-exist')).toBeNull();
    });
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

  test('finds a 360dialog channel by its configured wabaId', async () => {
    const created = await createChannel({
      type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990005',
      config: { apiKey: 'key-1', wabaId: 'waba-360-2', webhookToken: 'tok-1' },
    });
    const found = await findChannelByWabaId('waba-360-2');
    expect(found.id).toBe(created.id);
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

  test('updates the wabaId of an existing 360dialog channel', async () => {
    const created = await createChannel({
      type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990006',
      config: { apiKey: 'key-1', wabaId: 'old-waba', webhookToken: 'tok-2' },
    });
    const updated = await updateChannelWabaId(created.id, 'new-waba');
    expect(updated.config.wabaId).toBe('new-waba');
  });
});

describe('hiding, dependents and deletion', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, platform_integrations CASCADE');
  });

  test('a new channel starts visible', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Novo', phoneNumber: '+5511999994001', config: {} });
    expect(channel.hidden).toBe(false);
  });

  test('updateChannelHidden hides a channel and listChannels stops returning it', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Antigo', phoneNumber: '+5511999994002', config: {} });
    const hiddenChannel = await updateChannelHidden(channel.id, true);
    expect(hiddenChannel.hidden).toBe(true);

    const visible = await listChannels();
    expect(visible.map((c) => c.id)).not.toContain(channel.id);
  });

  test('listChannels with includeHidden returns hidden channels too', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Antigo', phoneNumber: '+5511999994003', config: {} });
    await updateChannelHidden(channel.id, true);

    const all = await listChannels({ includeHidden: true });
    expect(all.map((c) => c.id)).toContain(channel.id);
  });

  test('updateChannelHidden can un-hide a channel', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Antigo', phoneNumber: '+5511999994004', config: {} });
    await updateChannelHidden(channel.id, true);
    const shown = await updateChannelHidden(channel.id, false);
    expect(shown.hidden).toBe(false);
    expect((await listChannels()).map((c) => c.id)).toContain(channel.id);
  });

  test('updateChannelHidden returns null for a non-existent id', async () => {
    expect(await updateChannelHidden('00000000-0000-0000-0000-000000000000', true)).toBeNull();
  });

  test('countChannelDependents returns zeros for a brand-new channel', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Limpo', phoneNumber: '+5511999994005', config: {} });
    expect(await countChannelDependents(channel.id)).toEqual({ conversations: 0, integrations: 0 });
  });

  test('countChannelDependents counts the conversations attached to the channel', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Usado', phoneNumber: '+5511999994006', config: {} });
    const contact = await findOrCreateContactByPhoneNumber('+5511977771111', 'Cliente');
    await createConversation(contact.id, channel.id);

    expect(await countChannelDependents(channel.id)).toEqual({ conversations: 1, integrations: 0 });
  });

  test('deleteChannel removes a channel with no dependents', async () => {
    const channel = await createChannel({ type: 'baileys', name: 'Descartavel', phoneNumber: '+5511999994007', config: {} });
    expect(await deleteChannel(channel.id)).toBe(true);
    expect(await findChannelById(channel.id)).toBeNull();
  });

  test('deleteChannel returns false for a non-existent id', async () => {
    expect(await deleteChannel('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
