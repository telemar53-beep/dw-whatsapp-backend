const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const { createMessage } = require('../conversations/message.repository');
const {
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('./sgp-integration.repository');

describe('sgp integration repository', () => {
  let channelId;
  let otherChannelId;
  let conversationId;
  let messageId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE platform_integrations, sgp_dispatches, conversations, contacts, channels CASCADE');
    const channel = await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', config: {} });
    channelId = channel.id;
    const otherChannel = await createChannel({ type: 'baileys', name: 'Outro', phoneNumber: '+5598900000001', config: {} });
    otherChannelId = otherChannel.id;
    const contact = await findOrCreateContactByPhoneNumber('+5511988885555', 'Cliente SGP');
    const conversation = await createConversation(contact.id, channelId);
    conversationId = conversation.id;
    const message = await createMessage({
      conversationId, direction: 'outbound', content: 'Oi', whatsappMessageId: null, status: 'sent',
    });
    messageId = message.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('listSgpIntegrations returns an empty array when none exist', async () => {
    expect(await listSgpIntegrations()).toEqual([]);
  });

  test('createSgpIntegration creates a new row with hasApiKey false', async () => {
    const integration = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    expect(integration.description).toBe('Baileys');
    expect(integration.channelId).toBe(channelId);
    expect(integration.mode).toBe('freetext');
    expect(integration.defaultTemplateId).toBeNull();
    expect(integration.enabled).toBe(true);
    expect(integration.hasApiKey).toBe(false);
  });

  test('listSgpIntegrations returns multiple integrations, oldest first', async () => {
    const first = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    const second = await createSgpIntegration({ description: 'Oficial', channelId: otherChannelId, mode: 'template', defaultTemplateId: null, enabled: true });
    const all = await listSgpIntegrations();
    expect(all.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  test('updateSgpIntegration updates fields without touching the api key', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    await rotateSgpApiKey(created.id);

    const updated = await updateSgpIntegration(created.id, { description: 'Baileys renomeado', channelId: otherChannelId, mode: 'freetext', defaultTemplateId: null, enabled: false });

    expect(updated.description).toBe('Baileys renomeado');
    expect(updated.channelId).toBe(otherChannelId);
    expect(updated.enabled).toBe(false);
    expect(updated.hasApiKey).toBe(true);
  });

  test('updateSgpIntegration returns null for a non-existent id', async () => {
    expect(await updateSgpIntegration('00000000-0000-0000-0000-000000000000', { description: 'x', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true })).toBeNull();
  });

  test('rotateSgpApiKey returns null for a non-existent id', async () => {
    expect(await rotateSgpApiKey('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('rotateSgpApiKey generates a plain key and stores only its hash', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });

    const rotated = await rotateSgpApiKey(created.id);

    expect(typeof rotated.apiKey).toBe('string');
    expect(rotated.apiKey.length).toBeGreaterThan(20);
    expect(rotated.integration.hasApiKey).toBe(true);
  });

  test('verifySgpApiKey reports not_configured when there are no integrations at all', async () => {
    expect(await verifySgpApiKey('anything')).toEqual({ status: 'not_configured' });
  });

  test('verifySgpApiKey reports invalid when integrations exist but none have a matching key', async () => {
    await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    expect(await verifySgpApiKey('anything')).toEqual({ status: 'invalid' });
  });

  test('verifySgpApiKey reports disabled when the matching integration is turned off', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: false });
    const rotated = await rotateSgpApiKey(created.id);

    expect(await verifySgpApiKey(rotated.apiKey)).toEqual({ status: 'disabled' });
  });

  test('verifySgpApiKey reports ok with channelId/mode/defaultTemplateId for the correct key', async () => {
    const created = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    const rotated = await rotateSgpApiKey(created.id);

    expect(await verifySgpApiKey(rotated.apiKey)).toEqual({ status: 'ok', channelId, mode: 'freetext', defaultTemplateId: null });
  });

  test('verifySgpApiKey distinguishes between two different registered integrations by key', async () => {
    const first = await createSgpIntegration({ description: 'Baileys', channelId, mode: 'freetext', defaultTemplateId: null, enabled: true });
    const firstKey = (await rotateSgpApiKey(first.id)).apiKey;
    const second = await createSgpIntegration({ description: 'Oficial', channelId: otherChannelId, mode: 'template', defaultTemplateId: null, enabled: true });
    const secondKey = (await rotateSgpApiKey(second.id)).apiKey;

    expect(await verifySgpApiKey(firstKey)).toEqual({ status: 'ok', channelId, mode: 'freetext', defaultTemplateId: null });
    expect(await verifySgpApiKey(secondKey)).toEqual({ status: 'ok', channelId: otherChannelId, mode: 'template', defaultTemplateId: null });
  });

  test('findSgpDispatchByReferenceId returns null when not found', async () => {
    expect(await findSgpDispatchByReferenceId('missing')).toBeNull();
  });

  test('createSgpDispatch stores and findSgpDispatchByReferenceId retrieves it', async () => {
    const dispatch = await createSgpDispatch({ referenceId: 'boleto-1', conversationId, messageId });
    expect(dispatch.referenceId).toBe('boleto-1');
    const found = await findSgpDispatchByReferenceId('boleto-1');
    expect(found).toEqual(dispatch);
  });

  test('createSgpDispatch rejects a duplicate referenceId with a unique-violation error', async () => {
    await createSgpDispatch({ referenceId: 'boleto-2', conversationId, messageId });
    await expect(createSgpDispatch({ referenceId: 'boleto-2', conversationId, messageId })).rejects.toMatchObject({ code: '23505' });
  });
});
