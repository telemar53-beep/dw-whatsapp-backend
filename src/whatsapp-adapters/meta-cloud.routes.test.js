jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../templates/template.service');
jest.mock('../conversations/message-status.service');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
  saveInboundMedia: jest.fn(),
}));
jest.mock('./meta-cloud.adapter', () => ({
  ...jest.requireActual('./meta-cloud.adapter'),
  downloadMetaMedia: jest.fn(),
}));
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveInboundMedia } = require('../media/media-storage');
const { downloadMetaMedia } = require('./meta-cloud.adapter');
const metaCloudRoutes = require('./meta-cloud.routes');

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use('/webhooks', metaCloudRoutes);
  return app;
}

function sign(bodyString, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

describe('GET /webhooks/meta', () => {
  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'verify-me';
  });

  test('responds with the challenge when the token matches', async () => {
    const res = await request(buildApp())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  test('responds 403 when the token does not match', async () => {
    const res = await request(buildApp())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/meta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'app-secret';
  });

  test('processes a valid, signed webhook payload', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
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
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.ABC',
      messageType: 'text',
      content: 'Ola',
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: undefined,
      locationLongitude: undefined,
      repliedToWhatsappMessageId: null,
      sentAt: null,
      timestampSource: 'meta_cloud',
    });
  });

  test('skips processing entirely for a hidden channel', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', hidden: true });

    const payload = {
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
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('responds 200 and continues processing when ingestInboundMessage fails for one message in a batch', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockRejectedValueOnce(new Error('db unavailable')).mockResolvedValueOnce({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [
                  { profile: { name: 'Carlos' }, wa_id: '5511999998888' },
                  { profile: { name: 'Maria' }, wa_id: '5511999997777' },
                ],
                messages: [
                  { from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } },
                  { from: '5511999997777', id: 'wamid.DEF', type: 'text', text: { body: 'Oi' } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledTimes(2);
  });

  test('rejects a payload with an invalid signature', async () => {
    const bodyString = JSON.stringify({ entry: [] });
    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .set('Content-Type', 'application/json')
      .send(bodyString);
    expect(res.status).toBe(403);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('rejects a non-JSON content-type request even with a well-formed signature header', async () => {
    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(res.status).toBe(403);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('downloads and saves media before ingesting an image message', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', config: { accessToken: 'tok-meta' } });
    ingestInboundMessage.mockResolvedValue({});
    downloadMetaMedia.mockResolvedValue(Buffer.from('fake-image-bytes'));
    saveInboundMedia.mockResolvedValue({ mediaPath: 'generated-name.jpg' });

    const payload = {
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
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(downloadMetaMedia).toHaveBeenCalledWith('MEDIA123', 'tok-meta');
    expect(saveInboundMedia).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), 'image/jpeg');
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.IMG',
      messageType: 'image',
      content: 'Comprovante',
      mediaPath: 'generated-name.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      locationLatitude: undefined,
      locationLongitude: undefined,
      repliedToWhatsappMessageId: null,
      sentAt: null,
      timestampSource: 'meta_cloud',
    });
  });

  test('ingests a location message without touching media storage', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', config: {} });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  { from: '5511999998888', id: 'wamid.LOC', type: 'location', location: { latitude: -3.1, longitude: -60.0 } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(downloadMetaMedia).not.toHaveBeenCalled();
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: null,
      whatsappMessageId: 'wamid.LOC',
      messageType: 'location',
      content: undefined,
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: -3.1,
      locationLongitude: -60.0,
      repliedToWhatsappMessageId: null,
      sentAt: null,
      timestampSource: 'meta_cloud',
    });
  });
});

describe('POST /webhooks/meta (template status updates)', () => {
  test('forwards the webhook body to applyTemplateStatusUpdates', async () => {
    const payload = { entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value: { message_template_id: '123', event: 'APPROVED' } }] }] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(applyTemplateStatusUpdates).toHaveBeenCalledWith(payload);
  });

  test('still returns 200 when applyTemplateStatusUpdates throws', async () => {
    applyTemplateStatusUpdates.mockRejectedValue(new Error('boom'));
    const payload = { entry: [] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
  });
});

describe('POST /webhooks/meta (message status updates)', () => {
  test('forwards the webhook body to applyMessageStatusUpdates', async () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.ABC', status: 'delivered' }] } }] }] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(applyMessageStatusUpdates).toHaveBeenCalledWith(payload);
  });

  test('still returns 200 when applyMessageStatusUpdates throws', async () => {
    applyMessageStatusUpdates.mockRejectedValue(new Error('boom'));
    const payload = { entry: [] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
  });
});

// O webhook oficial descartava em silencio nos dois pontos abaixo: um
// META_APP_SECRET errado derrubava 100% das mensagens sem escrever uma linha
// no log, e um phoneNumberId cadastrado errado fazia o mesmo. Os avisos nunca
// carregam o corpo da requisicao, que traz mensagem e telefone do cliente.
describe('POST /webhooks/meta — avisos no log de descarte silencioso', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'app-secret';
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function warnings() {
    return warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  test('avisa que a assinatura nao confere quando o segredo esta errado', async () => {
    const bodyString = JSON.stringify({ entry: [] });

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'segredo-errado'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(warnSpy).toHaveBeenCalled();
    expect(warnings()).toMatch(/META_APP_SECRET/);
  });

  test('avisa quando falta o cabecalho de assinatura', async () => {
    const bodyString = JSON.stringify({ entry: [] });

    await request(buildApp()).post('/webhooks/meta').set('Content-Type', 'application/json').send(bodyString);

    expect(warnSpy).toHaveBeenCalled();
    expect(warnings()).toMatch(/META_APP_SECRET/);
  });

  test('nao inclui o corpo da requisicao no aviso de assinatura', async () => {
    const bodyString = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'segredo do cliente' } }],
              },
            },
          ],
        },
      ],
    });

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'segredo-errado'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(warnings()).not.toMatch(/segredo do cliente/);
    expect(warnings()).not.toMatch(/5511999998888/);
  });

  test('avisa com o phone number id quando nenhum canal corresponde', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue(null);
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '530351070168344' },
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } }],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'app-secret'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(warnings()).toMatch(/530351070168344/);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('avisa que o canal esta oculto em vez de dizer que nao existe', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', name: 'DW Telecom', hidden: true });
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '530351070168344' },
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } }],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'app-secret'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(warnings()).toMatch(/oculto/i);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('nao avisa nada quando a mensagem e processada normalmente', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', hidden: false });
    ingestInboundMessage.mockResolvedValue({});
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '530351070168344' },
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } }],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'app-secret'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// O horario que a Meta informa precisa chegar ate a gravacao: e ele que define
// a ordem no historico e a janela de 24 h que o atendente enxerga.
describe('POST /webhooks/meta — hora informada pela Meta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'app-secret';
  });

  test('repassa o horario do webhook para o ingest', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', hidden: false });
    ingestInboundMessage.mockResolvedValue({});
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                messages: [{ from: '5511999998888', id: 'wamid.HORA', type: 'text', text: { body: 'Ok' }, timestamp: '1758000000' }],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'app-secret'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sentAt: new Date(1758000000 * 1000) })
    );
  });
});

// Ponta a ponta: o que importa nao e o parser entender o botao, e sim a
// resposta chegar ao chat. Enquanto ela caia no vazio, a Meta considera o
// cliente respondido (janela de 24 h aberta) e o atendente nao ve nada —
// o pior dos dois mundos.
describe('POST /webhooks/meta — resposta de botao de template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'app-secret';
  });

  test('registra a resposta do botao como mensagem do cliente', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
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
                    id: 'wamid.BTN',
                    type: 'button',
                    button: { text: 'Pode agendar', payload: 'AGENDAR' },
                    context: { id: 'wamid.TEMPLATE' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', sign(bodyString, 'app-secret'))
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        messageType: 'text',
        content: 'Pode agendar',
        repliedToWhatsappMessageId: 'wamid.TEMPLATE',
      })
    );
  });
});
