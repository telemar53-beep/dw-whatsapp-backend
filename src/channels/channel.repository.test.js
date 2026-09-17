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
  updateChannelAiEnabled,
  updateChannelAiTriageEnabled,
  updateChannelAiNightModeEnabled,
  countChannelDependents,
  deleteChannel,
  convertChannelToMetaCloud,
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

  // O roteamento de entrada acha o canal pelo phoneNumberId e usa rows[0]. Com
  // dois canais no mesmo ID, quem recebe as mensagens viraria sorteio do
  // Postgres, entao o banco recusa a duplicata em vez de escolher no escuro.
  test('recusa dois canais meta_cloud com o mesmo Phone Number ID', async () => {
    await createChannel({
      type: 'meta_cloud',
      name: 'Primeiro',
      phoneNumber: '+5598984454546',
      config: { phoneNumberId: '530351070168344', accessToken: 'tok' },
    });

    await expect(
      createChannel({
        type: 'meta_cloud',
        name: 'Duplicado',
        phoneNumber: '+5598984454547',
        config: { phoneNumberId: '530351070168344', accessToken: 'tok' },
      })
    ).rejects.toMatchObject({ code: '23505' });
  });

  test('deixa dois canais de tipos diferentes conviverem sem phoneNumberId', async () => {
    await createChannel({ type: 'baileys', name: 'Um', phoneNumber: '+5511900000001', config: {} });
    await expect(
      createChannel({ type: 'baileys', name: 'Dois', phoneNumber: '+5511900000002', config: {} })
    ).resolves.toBeDefined();
  });

  test('createChannel aceita um status inicial explicito', async () => {
    // Canal oficial (meta_cloud/360dialog) nao tem handshake para nos avisar:
    // ele ja nasce conectado, senao ficaria "Desconectado" para sempre.
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Oficial Conectado',
      phoneNumber: '+5511999990030',
      config: { phoneNumberId: '111', accessToken: 'tok' },
      status: 'connected',
    });
    expect(channel.status).toBe('connected');
    expect((await findChannelById(channel.id)).status).toBe('connected');
  });

  test('createChannel sem status usa o DEFAULT do banco', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Sem Status',
      phoneNumber: '+5511999990031',
      config: {},
    });
    expect(channel.status).toBe('disconnected');
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

  test('updateChannelAiEnabled turns AI on and off', async () => {
    const channel = await createChannel({
      type: 'baileys',
      name: 'Canal IA Liga Desliga',
      phoneNumber: '+5511999990026',
      config: {},
    });

    const enabled = await updateChannelAiEnabled(channel.id, true);
    expect(enabled.aiEnabled).toBe(true);

    const disabled = await updateChannelAiEnabled(channel.id, false);
    expect(disabled.aiEnabled).toBe(false);
  });

  test('updateChannelAiEnabled returns null when the channel does not exist', async () => {
    const result = await updateChannelAiEnabled('00000000-0000-0000-0000-000000000000', true);
    expect(result).toBeNull();
  });

  test('aiTriageEnabled nasce false, é alterável e volta por findChannelById e listChannels', async () => {
    const ch = await createChannel({ type: 'baileys', name: 'C', phoneNumber: '+5511999990027', config: {} });
    expect(ch.aiTriageEnabled).toBe(false);
    const on = await updateChannelAiTriageEnabled(ch.id, true);
    expect(on.aiTriageEnabled).toBe(true);
    expect((await findChannelById(ch.id)).aiTriageEnabled).toBe(true);
    expect((await listChannels()).find((c) => c.id === ch.id).aiTriageEnabled).toBe(true);
  });

  test('aiNightModeEnabled nasce false, é alterável e volta por findChannelById e listChannels', async () => {
    const ch = await createChannel({ type: 'baileys', name: 'N', phoneNumber: '+5511999990028', config: {} });
    expect(ch.aiNightModeEnabled).toBe(false);
    const on = await updateChannelAiNightModeEnabled(ch.id, true);
    expect(on.aiNightModeEnabled).toBe(true);
    expect((await findChannelById(ch.id)).aiNightModeEnabled).toBe(true);
    expect((await listChannels()).find((c) => c.id === ch.id).aiNightModeEnabled).toBe(true);
  });

  test('updateChannelAiNightModeEnabled returns null when the channel does not exist', async () => {
    const result = await updateChannelAiNightModeEnabled('00000000-0000-0000-0000-000000000000', true);
    expect(result).toBeNull();
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
      // Valor proprio: este describe e irmao do 'channel repository', entao nao
      // passa pelo TRUNCATE do beforeEach dele, e o phoneNumberId agora e unico.
      config: { phoneNumberId: '1234567891', accessToken: 'tok', wabaId: 'old-waba' },
    });
    const updated = await updateChannelWabaId(created.id, 'new-waba');
    expect(updated.config.wabaId).toBe('new-waba');
    expect(updated.config.phoneNumberId).toBe('1234567891');
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

// Migrar um numero de provedor e converter o canal no lugar, nunca recriar: o
// id e o telefone continuam os mesmos, entao conversas, campanhas, protocolos
// e a integracao SGP daquele numero seguem apontando para ele.
describe('convertChannelToMetaCloud', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE channels CASCADE');
  });

  const CONFIG_NOVA = { phoneNumberId: '613336748527998', accessToken: 'tok-meta', wabaId: '3530350190603464' };

  test('converte um canal 360dialog mantendo id, telefone e nome', async () => {
    const original = await createChannel({
      type: '360dialog',
      name: 'DW Telcom 3',
      phoneNumber: '+5598970285660',
      config: { apiKey: 'd360-key', wabaId: 'waba-antiga', webhookToken: 'tok-webhook' },
    });

    const convertido = await convertChannelToMetaCloud(original.id, CONFIG_NOVA);

    expect(convertido.id).toBe(original.id);
    expect(convertido.phoneNumber).toBe('+5598970285660');
    expect(convertido.name).toBe('DW Telcom 3');
    expect(convertido.type).toBe('meta_cloud');
  });

  test('apaga a apiKey e o webhookToken da 360dialog', async () => {
    const original = await createChannel({
      type: '360dialog',
      name: 'DW Telcom 3',
      phoneNumber: '+5598970285661',
      config: { apiKey: 'd360-key', wabaId: 'waba-antiga', webhookToken: 'tok-webhook' },
    });

    const convertido = await convertChannelToMetaCloud(original.id, CONFIG_NOVA);

    expect(convertido.config).toEqual(CONFIG_NOVA);
    expect(convertido.config.apiKey).toBeUndefined();
    expect(convertido.config.webhookToken).toBeUndefined();
  });

  test('o webhook do 360dialog deixa de achar o canal pelo token antigo', async () => {
    const original = await createChannel({
      type: '360dialog',
      name: 'DW Telcom 3',
      phoneNumber: '+5598970285662',
      config: { apiKey: 'd360-key', wabaId: 'w', webhookToken: 'tok-orfao' },
    });

    await convertChannelToMetaCloud(original.id, CONFIG_NOVA);

    expect(await findChannelByWebhookToken('tok-orfao')).toBeNull();
  });

  test('o webhook da Meta passa a achar o canal pelo phoneNumberId novo', async () => {
    const original = await createChannel({
      type: 'baileys',
      name: 'automação',
      phoneNumber: '+5598984129046',
      config: {},
    });

    await convertChannelToMetaCloud(original.id, CONFIG_NOVA);

    const achado = await findChannelByMetaPhoneNumberId('613336748527998');
    expect(achado.id).toBe(original.id);
  });

  test('preserva as configuracoes de atendimento do canal', async () => {
    const original = await createChannel({
      type: '360dialog',
      name: 'DW Telcom 3',
      phoneNumber: '+5598970285663',
      config: { apiKey: 'k', wabaId: 'w', webhookToken: 't' },
    });
    await updateChannelWelcomeMessage(original.id, 'Olá! Bem-vindo.');
    await updateChannelAiEnabled(original.id, true);

    const convertido = await convertChannelToMetaCloud(original.id, CONFIG_NOVA);

    expect(convertido.welcomeMessage).toBe('Olá! Bem-vindo.');
    expect(convertido.aiEnabled).toBe(true);
  });

  test('devolve null para um canal que nao existe', async () => {
    expect(await convertChannelToMetaCloud('00000000-0000-0000-0000-000000000000', CONFIG_NOVA)).toBeNull();
  });
});
