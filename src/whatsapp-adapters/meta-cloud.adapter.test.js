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
  test('extracts text messages with contact name and phone_number_id', () => {
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
        content: 'Ola',
      },
    ]);
  });

  test('ignores non-text messages', () => {
    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [{ from: '5511999998888', id: 'wamid.IMG', type: 'image' }],
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
