const bcrypt = require('bcrypt');
const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const { createMessage } = require('../conversations/message.repository');
const {
  getSgpIntegration,
  saveSgpIntegrationChannel,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('./sgp-integration.repository');

describe('sgp integration repository', () => {
  let channelId;
  let conversationId;
  let messageId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE platform_integrations, sgp_dispatches, conversations, contacts, channels CASCADE');
    const channel = await createChannel({ type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', config: {} });
    channelId = channel.id;
    const contact = await findOrCreateContactByPhoneNumber('+5511988885555', 'Cliente SGP');
    const conversation = await createConversation(contact.id, channelId);
    conversationId = conversation.id;
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Oi',
      whatsappMessageId: null,
      status: 'sent',
    });
    messageId = message.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('getSgpIntegration returns null when not configured', async () => {
    expect(await getSgpIntegration()).toBeNull();
  });

  test('saveSgpIntegrationChannel creates the singleton row on first call', async () => {
    const integration = await saveSgpIntegrationChannel({ channelId, enabled: true });
    expect(integration.channelId).toBe(channelId);
    expect(integration.enabled).toBe(true);
    expect(integration.hasApiKey).toBe(false);
  });

  test('saveSgpIntegrationChannel updates the existing row without touching the api key', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });
    await rotateSgpApiKey();

    const otherChannel = await createChannel({ type: 'baileys', name: 'Outro', phoneNumber: '+5598900000001', config: {} });
    const updated = await saveSgpIntegrationChannel({ channelId: otherChannel.id, enabled: false });

    expect(updated.channelId).toBe(otherChannel.id);
    expect(updated.enabled).toBe(false);
    expect(updated.hasApiKey).toBe(true);
  });

  test('rotateSgpApiKey returns null when no integration has been configured yet', async () => {
    expect(await rotateSgpApiKey()).toBeNull();
  });

  test('rotateSgpApiKey generates a plain key and stores only its hash', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });

    const rotated = await rotateSgpApiKey();

    expect(typeof rotated.apiKey).toBe('string');
    expect(rotated.apiKey.length).toBeGreaterThan(20);
    expect(rotated.integration.hasApiKey).toBe(true);
    const integration = await getSgpIntegration();
    expect(integration.hasApiKey).toBe(true);
  });

  test('verifySgpApiKey reports not_configured when there is no integration row', async () => {
    expect(await verifySgpApiKey('anything')).toEqual({ status: 'not_configured' });
  });

  test('verifySgpApiKey reports disabled when the integration is turned off', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: false });
    await rotateSgpApiKey();

    expect(await verifySgpApiKey('anything')).toEqual({ status: 'disabled' });
  });

  test('verifySgpApiKey reports no_key when a channel is set but no key was generated', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });

    expect(await verifySgpApiKey('anything')).toEqual({ status: 'no_key' });
  });

  test('verifySgpApiKey reports invalid for a wrong key', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });
    await rotateSgpApiKey();

    expect(await verifySgpApiKey('wrong-key')).toEqual({ status: 'invalid' });
  });

  test('verifySgpApiKey reports ok and the channel id for the correct key', async () => {
    await saveSgpIntegrationChannel({ channelId, enabled: true });
    const rotated = await rotateSgpApiKey();

    expect(await verifySgpApiKey(rotated.apiKey)).toEqual({ status: 'ok', channelId });
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

    await expect(createSgpDispatch({ referenceId: 'boleto-2', conversationId, messageId })).rejects.toMatchObject({
      code: '23505',
    });
  });
});
