jest.mock('../channels/channel.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('./campaign.repository');

const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { updateCampaignRecipientStatus, incrementCampaignCounter } = require('./campaign.repository');
const { processCampaignRecipient } = require('./campaign-processor');

const BASE_JOB = {
  recipientId: 'recipient-1',
  campaignId: 'campaign-1',
  channelId: 'channel-1',
  phoneNumber: '5511999990000',
  displayName: 'Joao',
  content: 'Ola Joao',
  templateName: null,
  templateLanguage: null,
  templateVariables: null,
};

beforeEach(() => jest.clearAllMocks());

describe('processCampaignRecipient', () => {
  test('marks failed when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'Canal não encontrado' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  test('sends via a baileys channel and marks sent', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5511999990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conversation-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'message-1' });

    await processCampaignRecipient(BASE_JOB);

    expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      channelId: 'channel-1',
      content: 'Ola Joao',
      templateName: undefined,
      templateLanguage: undefined,
      templateVariables: undefined,
    });
    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'sent', contactId: 'contact-1', conversationId: 'conversation-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'sent');
  });

  test('marks failed when a baileys number is not on WhatsApp', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue(null);

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'Número não está no WhatsApp' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
    expect(createConversation).not.toHaveBeenCalled();
  });

  test('marks failed when the baileys channel has no active connection', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    baileysManager.resolveWhatsAppJid.mockRejectedValue(new Error('No active Baileys connection for channel channel-1'));

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'No active Baileys connection for channel channel-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  test('marks skipped when the contact already has an open conversation on the channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue({ id: 'conversation-existing', status: 'silent' });

    await processCampaignRecipient({ ...BASE_JOB, phoneNumber: '5511999990000' });

    expect(createConversation).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'skipped', contactId: 'contact-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'skipped');
  });

  test('sends a template message via an official channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conversation-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'message-1' });

    await processCampaignRecipient({
      ...BASE_JOB,
      content: 'Ola Joao, sua fatura vence em 10/09',
      templateName: 'fatura_vencendo',
      templateLanguage: 'pt_BR',
      templateVariables: ['Joao', '10/09'],
    });

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      channelId: 'channel-1',
      content: 'Ola Joao, sua fatura vence em 10/09',
      templateName: 'fatura_vencendo',
      templateLanguage: 'pt_BR',
      templateVariables: ['Joao', '10/09'],
    });
  });

  test('marks failed when enqueueOutboundMessage throws', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conversation-1' });
    enqueueOutboundMessage.mockRejectedValue(new Error('boom'));

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'boom', contactId: 'contact-1', conversationId: 'conversation-1' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  test('marks failed when a repository call throws unexpectedly', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    findOrCreateContactByPhoneNumber.mockRejectedValue(new Error('connection lost'));

    await processCampaignRecipient(BASE_JOB);

    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('recipient-1', expect.objectContaining({ status: 'failed', errorMessage: 'connection lost' }));
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });
});
