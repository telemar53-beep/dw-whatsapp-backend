const crypto = require('crypto');
const { verifyWebhookChallenge, verifySignature, parseInboundMessages } = require('./meta-cloud.adapter');

describe('verifyWebhookChallenge', () => {
  test('returns the challenge when mode and token match', () => {
    const result = verifyWebhookChallenge(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'secret-token', 'hub.challenge': '12345' },
      'secret-token'
    );
    expect(result).toBe('12345');
  });

  test('returns null when the token does not match', () => {
    const result = verifyWebhookChallenge(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': '12345' },
      'secret-token'
    );
    expect(result).toBeNull();
  });
});

describe('verifySignature', () => {
  const appSecret = 'app-secret-123';
  const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));

  function signatureFor(body) {
    const hash = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
    return `sha256=${hash}`;
  }

  test('returns true for a valid signature', () => {
    const signature = signatureFor(rawBody);
    expect(verifySignature(rawBody, signature, appSecret)).toBe(true);
  });

  test('returns false for an invalid signature', () => {
    const wrongButSameLength = 'sha256=' + '0'.repeat(64);
    expect(verifySignature(rawBody, wrongButSameLength, appSecret)).toBe(false);
  });

  test('returns false when the header is missing', () => {
    expect(verifySignature(rawBody, undefined, appSecret)).toBe(false);
  });
});

describe('parseInboundMessages', () => {
  test('extracts text messages with contact name, phone_number_id, and messageType text', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } }],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Carlos',
        whatsappMessageId: 'wamid.ABC',
        messageType: 'text',
        content: 'Ola',
      },
    ]);
  });

  test('extracts an image message with a caption', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.IMG',
                    type: 'image',
                    image: { id: 'MEDIA123', mime_type: 'image/jpeg', caption: 'Comprovante' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Carlos',
        whatsappMessageId: 'wamid.IMG',
        messageType: 'image',
        mediaId: 'MEDIA123',
        mediaMimeType: 'image/jpeg',
        mediaFilename: null,
        content: 'Comprovante',
      },
    ]);
  });

  test('extracts a document message with a filename and no caption', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.DOC',
                    type: 'document',
                    document: { id: 'MEDIA456', mime_type: 'application/pdf', filename: 'comprovante.pdf' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: 'wamid.DOC',
        messageType: 'document',
        mediaId: 'MEDIA456',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'comprovante.pdf',
        content: null,
      },
    ]);
  });

  test.each(['audio', 'video', 'sticker'])('extracts a %s message', (type) => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [{ from: '5511999998888', id: `wamid.${type}`, type, [type]: { id: 'MEDIA789', mime_type: 'application/octet-stream' } }],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: `wamid.${type}`,
        messageType: type,
        mediaId: 'MEDIA789',
        mediaMimeType: 'application/octet-stream',
        mediaFilename: null,
        content: null,
      },
    ]);
  });

  test('extracts a location message with coordinates and no media fields', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.LOC',
                    type: 'location',
                    location: { latitude: -3.119, longitude: -60.021 },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = parseInboundMessages(webhookBody);
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: 'wamid.LOC',
        messageType: 'location',
        latitude: -3.119,
        longitude: -60.021,
      },
    ]);
  });

  test('skips a media message missing its per-type sub-object, without throwing, alongside a valid message', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [
                  { from: '5511999998888', id: 'wamid.BADIMG', type: 'image' },
                  { from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } },
                ],
              },
            },
          ],
        },
      ],
    };
    let result;
    expect(() => {
      result = parseInboundMessages(webhookBody);
    }).not.toThrow();
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Carlos',
        whatsappMessageId: 'wamid.ABC',
        messageType: 'text',
        content: 'Ola',
      },
    ]);
  });

  test('skips a location message missing its location sub-object, without throwing, alongside a valid message', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  { from: '5511999998888', id: 'wamid.BADLOC', type: 'location' },
                  { from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } },
                ],
              },
            },
          ],
        },
      ],
    };
    let result;
    expect(() => {
      result = parseInboundMessages(webhookBody);
    }).not.toThrow();
    expect(result).toEqual([
      {
        metaPhoneNumberId: '1234567890',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: null,
        whatsappMessageId: 'wamid.ABC',
        messageType: 'text',
        content: 'Ola',
      },
    ]);
  });

  test('ignores unsupported message types (e.g. reactions)', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [{ from: '5511999998888', id: 'wamid.REACT', type: 'reaction' }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundMessages(webhookBody)).toEqual([]);
  });

  test('returns an empty array when there are no entries', () => {
    expect(parseInboundMessages({})).toEqual([]);
  });
});

describe('downloadMetaMedia', () => {
  test('fetches the temporary media URL then downloads the file bytes', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbx.com/temp-url' } })
      .mockResolvedValueOnce({ data: Buffer.from('fake-bytes') });

    const buffer = await downloadMetaMedia('MEDIA123', 'token-abc');

    expect(axios.get).toHaveBeenNthCalledWith(1, 'https://graph.facebook.com/v20.0/MEDIA123', {
      headers: { Authorization: 'Bearer token-abc' },
    });
    expect(axios.get).toHaveBeenNthCalledWith(2, 'https://lookaside.fbsbx.com/temp-url', {
      headers: { Authorization: 'Bearer token-abc' },
      responseType: 'arraybuffer',
    });
    expect(buffer).toEqual(Buffer.from('fake-bytes'));
  });
});

jest.mock('axios');
const axios = require('axios');
const { sendTextMessage, downloadMetaMedia, sendMediaMessage } = require('./meta-cloud.adapter');

describe('sendTextMessage', () => {
  test('posts to the Graph API and returns the WhatsApp message id', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.SENT123' }] } });
    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };

    const result = await sendTextMessage(channel, '5511999998888', 'Resposta do atendente');

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/1234567890/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'Resposta do atendente' } },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.SENT123' });
  });
});

jest.mock('fs');
const fs = require('fs');
jest.mock('../media/media-storage');
const { getMediaFilePath } = require('../media/media-storage');

describe('sendMediaMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uploads the file then sends a message referencing the returned media id', async () => {
    getMediaFilePath.mockReturnValue('/fake/path/to/file');
    fs.promises = { readFile: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')) };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'UPLOADED_MEDIA_ID' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.SENT_IMG' }] } });

    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };
    const result = await sendMediaMessage(channel, '5511999998888', {
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      caption: 'Resposta do atendente',
    });

    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v20.0/1234567890/media',
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }) })
    );
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'image',
        image: { id: 'UPLOADED_MEDIA_ID', caption: 'Resposta do atendente' },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(result).toEqual({ whatsappMessageId: 'wamid.SENT_IMG' });
  });

  test('omits caption from the message payload when there is none', async () => {
    getMediaFilePath.mockReturnValue('/fake/path/to/file');
    fs.promises = { readFile: jest.fn().mockResolvedValue(Buffer.from('fake-doc-bytes')) };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'UPLOADED_MEDIA_ID_2' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.SENT_DOC' }] } });

    const channel = { config: { phoneNumberId: '1234567890', accessToken: 'token-abc' } };
    await sendMediaMessage(channel, '5511999998888', {
      messageType: 'document',
      mediaPath: 'doc.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
      caption: null,
    });

    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v20.0/1234567890/messages',
      {
        messaging_product: 'whatsapp',
        to: '5511999998888',
        type: 'document',
        document: { id: 'UPLOADED_MEDIA_ID_2' },
      },
      { headers: { Authorization: 'Bearer token-abc' } }
    );
  });
});
