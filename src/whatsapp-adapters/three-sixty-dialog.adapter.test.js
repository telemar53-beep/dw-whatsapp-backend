const axios = require('axios');
const {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  registerWebhook,
  parseInboundMessages,
} = require('./three-sixty-dialog.adapter');

jest.mock('axios');
jest.mock('fs');
jest.mock('../media/media-storage');
const fs = require('fs');
const { getMediaFilePath } = require('../media/media-storage');

const CHANNEL = { id: 'channel-1', config: { apiKey: 'd360-key-abc', wabaId: 'waba-1', webhookToken: 'token-xyz' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendTextMessage', () => {
  test('posts to waba-v2.360dialog.io/messages with the D360-API-KEY header', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.SENT1' }] } });

    const result = await sendTextMessage(CHANNEL, '5511999998888', 'Ola');

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'Ola' } },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.SENT1' });
  });

  test('includes a reply context when repliedToWhatsappMessageId is passed', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.REPLY1' }] } });

    await sendTextMessage(CHANNEL, '5511999998888', 'Ola', { repliedToWhatsappMessageId: 'wamid.ORIGINAL' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      expect.objectContaining({ context: { message_id: 'wamid.ORIGINAL' } }),
      expect.anything()
    );
  });
});

describe('sendTemplateMessage', () => {
  test('sends a template message with body variables', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.TPL1' }] } });

    const result = await sendTemplateMessage(CHANNEL, '5511999998888', {
      name: 'fatura_vencida',
      language: 'pt_BR',
      variables: ['Joao', '150,00'],
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'template',
        template: {
          name: 'fatura_vencida',
          language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'Joao' }, { type: 'text', text: '150,00' }] }],
        },
      },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.TPL1' });
  });
});

describe('sendMediaMessage', () => {
  test('uploads the file then sends a media message referencing the uploaded id', async () => {
    getMediaFilePath.mockReturnValue('/fake/path/to/file');
    fs.promises = { readFile: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')) };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'media-360-1' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.MEDIA1' }] } });

    const result = await sendMediaMessage(CHANNEL, '5511999998888', {
      messageType: 'image',
      mediaPath: 'foo.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: 'foo.jpg',
      caption: 'Comprovante',
    });

    expect(axios.post).toHaveBeenNthCalledWith(1, 'https://waba-v2.360dialog.io/media', expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({ 'D360-API-KEY': 'd360-key-abc' }),
    }));
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://waba-v2.360dialog.io/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'image', image: { id: 'media-360-1', caption: 'Comprovante' } },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.MEDIA1' });
  });
});

describe('createMetaTemplate', () => {
  test('posts to message_templates with the D360-API-KEY header', async () => {
    axios.post.mockResolvedValue({ data: { id: 'tpl-360-1', status: 'PENDING' } });

    const result = await createMetaTemplate(CHANNEL, { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Ola {{1}}' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/message_templates',
      { name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', components: [{ type: 'BODY', text: 'Ola {{1}}' }] },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
    expect(result).toEqual({ metaTemplateId: 'tpl-360-1', status: 'PENDING' });
  });
});

describe('listMetaTemplates', () => {
  test('gets message_templates and returns the data array', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ id: 'tpl-1', name: 'fatura_vencida', status: 'APPROVED' }] } });

    const result = await listMetaTemplates(CHANNEL);

    expect(axios.get).toHaveBeenCalledWith('https://waba-v2.360dialog.io/message_templates', { headers: { 'D360-API-KEY': 'd360-key-abc' } });
    expect(result).toEqual([{ id: 'tpl-1', name: 'fatura_vencida', status: 'APPROVED' }]);
  });
});

describe('deleteMetaTemplate', () => {
  test('deletes by name and hsm_id', async () => {
    axios.delete.mockResolvedValue({});

    await deleteMetaTemplate(CHANNEL, { name: 'fatura_vencida', metaTemplateId: 'tpl-360-1' });

    expect(axios.delete).toHaveBeenCalledWith('https://waba-v2.360dialog.io/message_templates', {
      headers: { 'D360-API-KEY': 'd360-key-abc' },
      params: { name: 'fatura_vencida', hsm_id: 'tpl-360-1' },
    });
  });
});

describe('registerWebhook', () => {
  test('posts the webhook URL to v1/configs/webhook', async () => {
    axios.post.mockResolvedValue({});

    await registerWebhook(CHANNEL, 'https://example.com/webhooks/360dialog/token-xyz');

    expect(axios.post).toHaveBeenCalledWith(
      'https://waba-v2.360dialog.io/v1/configs/webhook',
      { url: 'https://example.com/webhooks/360dialog/token-xyz' },
      { headers: { 'D360-API-KEY': 'd360-key-abc' } }
    );
  });

  test('propagates an error when the API key is rejected', async () => {
    axios.post.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(registerWebhook(CHANNEL, 'https://example.com/webhooks/360dialog/token-xyz')).rejects.toThrow('401 Unauthorized');
  });
});

describe('re-exported webhook parsers', () => {
  test('parseInboundMessages is the same function as meta-cloud.adapter exports', () => {
    const metaCloudAdapter = require('./meta-cloud.adapter');
    expect(parseInboundMessages).toBe(metaCloudAdapter.parseInboundMessages);
  });
});
