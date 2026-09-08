jest.mock('@whiskeysockets/baileys', () => ({
  default: jest.fn(),
  useMultiFileAuthState: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: jest.fn(),
}));
jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/message-status.service');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
  getMediaFilePath: jest.fn(),
}));
jest.mock('../config/env');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    rm: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('axios');

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const baileysLib = require('@whiskeysockets/baileys');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { setContactAvatarPath } = require('../conversations/contact.repository');
const { applyParsedMessageStatusUpdates } = require('../conversations/message-status.service');
const manager = require('./baileys.manager');

function createMockSock() {
  const handlers = {};
  return {
    ev: {
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
    },
    sendMessage: jest.fn().mockResolvedValue({ key: { id: 'wamid.SENT1' } }),
    onWhatsApp: jest.fn(),
    profilePictureUrl: jest.fn(),
    handlers,
  };
}

describe('baileys.manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadConfig.mockReturnValue({ baileysSessionsDir: '/sessions' });
    baileysLib.useMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: jest.fn() });
    ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-default' }, contactJustCreated: false });
  });

  describe('startBaileysConnection', () => {
    test('opens the auth state from the per-channel session directory and creates a socket', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-1', type: 'baileys' };

      await manager.startBaileysConnection(channel);

      expect(baileysLib.useMultiFileAuthState).toHaveBeenCalledWith(path.join('/sessions', 'channel-1'));
      expect(baileysLib.default).toHaveBeenCalledWith(expect.objectContaining({ auth: {} }));
      expect(sock.ev.on).toHaveBeenCalledWith('creds.update', expect.any(Function));
      expect(sock.ev.on).toHaveBeenCalledWith('connection.update', expect.any(Function));
      expect(sock.ev.on).toHaveBeenCalledWith('messages.upsert', expect.any(Function));
      expect(sock.ev.on).toHaveBeenCalledWith('messages.update', expect.any(Function));
    });
  });

  describe('connection.update handling', () => {
    let sock;
    let channel;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      channel = { id: 'channel-2', type: 'baileys' };
      await manager.startBaileysConnection(channel);
    });

    test('stores the QR code and marks the channel as awaiting_qr', async () => {
      await sock.handlers['connection.update']({ qr: 'qr-raw-string' });

      expect(updateChannelStatus).toHaveBeenCalledWith('channel-2', 'awaiting_qr');
      expect(manager.getQrForChannel('channel-2')).toBe('qr-raw-string');
    });

    test('clears the QR code and marks the channel as connected when the connection opens', async () => {
      await sock.handlers['connection.update']({ qr: 'qr-raw-string' });
      await sock.handlers['connection.update']({ connection: 'open' });

      expect(updateChannelStatus).toHaveBeenCalledWith('channel-2', 'connected');
      expect(manager.getQrForChannel('channel-2')).toBeNull();
    });

    test('marks the channel disconnected and deletes the session on a logout', async () => {
      await sock.handlers['connection.update']({
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } },
      });

      expect(updateChannelStatus).toHaveBeenCalledWith('channel-2', 'disconnected');
      expect(fs.promises.rm).toHaveBeenCalledWith(path.join('/sessions', 'channel-2'), {
        recursive: true,
        force: true,
      });
      expect(baileysLib.default).toHaveBeenCalledTimes(1);
    });

    test('reconnects automatically on a recoverable disconnect', async () => {
      await sock.handlers['connection.update']({
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 500 } } },
      });

      expect(baileysLib.default).toHaveBeenCalledTimes(2);
      expect(updateChannelStatus).not.toHaveBeenCalledWith('channel-2', 'disconnected');
    });
  });

  describe('messages.upsert handling', () => {
    let sock;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-3', type: 'baileys' });
    });

    test('ingests a text message received from a contact', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'BAILEYS_MSG_1' },
            pushName: 'Cliente Baileys',
            message: { conversation: 'Oi, preciso de ajuda' },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Cliente Baileys',
        whatsappMessageId: 'BAILEYS_MSG_1',
        messageType: 'text',
        content: 'Oi, preciso de ajuda',
      });
    });

    test('ingests an extended text message (reply/quoted message)', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'BAILEYS_MSG_2' },
            pushName: 'Outro Cliente',
            message: { extendedTextMessage: { text: 'Respondendo aqui' } },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999997777',
        contactDisplayName: 'Outro Cliente',
        whatsappMessageId: 'BAILEYS_MSG_2',
        messageType: 'text',
        content: 'Respondendo aqui',
      });
    });

    test('ingests a buttons message from a verified business account', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'BAILEYS_BTN_1' },
            pushName: 'Banco Exemplo',
            message: {
              buttonsMessage: {
                contentText: 'Seu cartao foi aprovado. Toque no botao abaixo para ativar.',
                footerText: 'Banco Exemplo',
                buttons: [{ buttonId: '1', buttonText: { displayText: 'Ativar' }, type: 1 }],
              },
            },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511988887777',
        contactDisplayName: 'Banco Exemplo',
        whatsappMessageId: 'BAILEYS_BTN_1',
        messageType: 'text',
        content: 'Seu cartao foi aprovado. Toque no botao abaixo para ativar.',
      });
    });

    test('ingests a hydrated template message from a verified business account', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511988886666@s.whatsapp.net', fromMe: false, id: 'BAILEYS_TPL_1' },
            pushName: 'Banco Exemplo',
            message: {
              templateMessage: {
                hydratedFourRowTemplate: {
                  hydratedContentText: 'Sua fatura vence em 3 dias.',
                  hydratedButtons: [{ quickReplyButton: { displayText: 'Ver fatura', id: '1' } }],
                },
              },
            },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511988886666',
        contactDisplayName: 'Banco Exemplo',
        whatsappMessageId: 'BAILEYS_TPL_1',
        messageType: 'text',
        content: 'Sua fatura vence em 3 dias.',
      });
    });

    test('ingests an interactive message from a verified business account', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511988885555@s.whatsapp.net', fromMe: false, id: 'BAILEYS_INT_1' },
            pushName: 'Empresa Exemplo',
            message: {
              interactiveMessage: {
                body: { text: 'Seu treino de hoje esta liberado.' },
                footer: { text: 'Empresa Exemplo' },
              },
            },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511988885555',
        contactDisplayName: 'Empresa Exemplo',
        whatsappMessageId: 'BAILEYS_INT_1',
        messageType: 'text',
        content: 'Seu treino de hoje esta liberado.',
      });
    });

    test('ignores messages sent by the connection itself', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999996666@s.whatsapp.net', fromMe: true, id: 'BAILEYS_MSG_3' },
            message: { conversation: 'Eco do proprio envio' },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('ignores non-notify upsert types (history sync)', async () => {
      await sock.handlers['messages.upsert']({
        type: 'append',
        messages: [
          {
            key: { remoteJid: '5511999995555@s.whatsapp.net', fromMe: false, id: 'X' },
            message: { conversation: 'Old' },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('ignores messages without extractable text content', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999994444@s.whatsapp.net', fromMe: false, id: 'IMG1' },
            message: { contactMessage: { displayName: 'Contato' } },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('ignores group and broadcast JIDs even with valid text content', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '120363xxx@g.us', fromMe: false, id: 'GROUP1' },
            pushName: 'Grupo Teste',
            message: { conversation: 'Mensagem de grupo' },
          },
          {
            key: { remoteJid: 'status@broadcast', fromMe: false, id: 'BROADCAST1' },
            pushName: 'Status',
            message: { conversation: 'Atualizacao de status' },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('resolves the real phone number via remoteJidAlt when the contact is addressed by LID', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: {
              remoteJid: '60194419654878@lid',
              remoteJidAlt: '559870079562@s.whatsapp.net',
              fromMe: false,
              id: 'LID_MSG_1',
              addressingMode: 'lid',
            },
            pushName: 'Cliente LID  ',
            message: { conversation: 'Oi, preciso de suporte' },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '559870079562',
        contactDisplayName: 'Cliente LID',
        whatsappMessageId: 'LID_MSG_1',
        messageType: 'text',
        content: 'Oi, preciso de suporte',
      });
    });

    test('ignores a LID-addressed message when no remoteJidAlt phone number is available', async () => {
      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: {
              remoteJid: '60194419654878@lid',
              fromMe: false,
              id: 'LID_MSG_2',
              addressingMode: 'lid',
            },
            pushName: 'Cliente Sem Alt',
            message: { conversation: 'Mensagem sem remoteJidAlt' },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('downloads and saves an image message with a caption', async () => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-image.jpg');
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('fake-image-bytes'));

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'BAILEYS_IMG_1' },
            pushName: 'Cliente Baileys',
            message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Comprovante' } },
          },
        ],
      });

      expect(baileysLib.downloadMediaMessage).toHaveBeenCalled();
      expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), '.jpg');
      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999998888',
        contactDisplayName: 'Cliente Baileys',
        whatsappMessageId: 'BAILEYS_IMG_1',
        messageType: 'image',
        content: 'Comprovante',
        mediaPath: 'generated-image.jpg',
        mediaMimeType: 'image/jpeg',
        mediaFilename: null,
      });
    });

    test('downloads a document message with a filename', async () => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-doc.pdf');
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('fake-doc-bytes'));

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'BAILEYS_DOC_1' },
            pushName: 'Outro Cliente',
            message: { documentMessage: { mimetype: 'application/pdf', fileName: 'comprovante.pdf' } },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999997777',
        contactDisplayName: 'Outro Cliente',
        whatsappMessageId: 'BAILEYS_DOC_1',
        messageType: 'document',
        content: null,
        mediaPath: 'generated-doc.pdf',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'comprovante.pdf',
      });
    });

    test.each(['audio', 'video', 'sticker'])('downloads and saves a %s message', async (type) => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue(`generated-${type}.bin`);
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from(`fake-${type}-bytes`));

      const messageKey = `${type}Message`;

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999991111@s.whatsapp.net', fromMe: false, id: `BAILEYS_${type.toUpperCase()}_1` },
            pushName: 'Cliente Baileys',
            message: { [messageKey]: { mimetype: `application/${type}-test` } },
          },
        ],
      });

      expect(baileysLib.downloadMediaMessage).toHaveBeenCalled();
      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999991111',
        contactDisplayName: 'Cliente Baileys',
        whatsappMessageId: `BAILEYS_${type.toUpperCase()}_1`,
        messageType: type,
        content: null,
        mediaPath: `generated-${type}.bin`,
        mediaMimeType: `application/${type}-test`,
        mediaFilename: null,
      });
    });

    test('unwraps an ephemeral (disappearing-messages) envelope to find the real image content', async () => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-ephemeral-image.jpg');
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('fake-ephemeral-bytes'));

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999993333@s.whatsapp.net', fromMe: false, id: 'BAILEYS_EPHEMERAL_1' },
            pushName: 'Cliente Efemero',
            message: {
              ephemeralMessage: {
                message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Foto temporaria' } },
              },
            },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999993333',
        contactDisplayName: 'Cliente Efemero',
        whatsappMessageId: 'BAILEYS_EPHEMERAL_1',
        messageType: 'image',
        content: 'Foto temporaria',
        mediaPath: 'generated-ephemeral-image.jpg',
        mediaMimeType: 'image/jpeg',
        mediaFilename: null,
      });
    });

    test('unwraps a view-once envelope to find the real audio content', async () => {
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-viewonce-audio.ogg');
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('fake-viewonce-bytes'));

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999992222@s.whatsapp.net', fromMe: false, id: 'BAILEYS_VIEWONCE_1' },
            pushName: 'Cliente Visualizacao Unica',
            message: {
              viewOnceMessageV2: {
                message: { audioMessage: { mimetype: 'audio/ogg' } },
              },
            },
          },
        ],
      });

      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999992222',
        contactDisplayName: 'Cliente Visualizacao Unica',
        whatsappMessageId: 'BAILEYS_VIEWONCE_1',
        messageType: 'audio',
        content: null,
        mediaPath: 'generated-viewonce-audio.ogg',
        mediaMimeType: 'audio/ogg',
        mediaFilename: null,
      });
    });

    test('logs the unrecognized message keys instead of failing silently with no trace', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999991234@s.whatsapp.net', fromMe: false, id: 'BAILEYS_UNKNOWN_1' },
            pushName: 'Cliente Desconhecido',
            message: { reactionMessage: { text: '👍' } },
          },
        ],
      });

      expect(ingestInboundMessage).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('reactionMessage'));
      logSpy.mockRestore();
    });

    test('ignores a media message sent by the connection itself (skips before any download work)', async () => {
      const { saveMediaFile } = require('../media/media-storage');

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999990000@s.whatsapp.net', fromMe: true, id: 'BAILEYS_ECHO_IMG_1' },
            pushName: 'Cliente Baileys',
            message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Comprovante' } },
          },
        ],
      });

      expect(baileysLib.downloadMediaMessage).not.toHaveBeenCalled();
      expect(saveMediaFile).not.toHaveBeenCalled();
      expect(ingestInboundMessage).not.toHaveBeenCalled();
    });

    test('ingests a location message with coordinates and no media download', async () => {
      const { saveMediaFile } = require('../media/media-storage');

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999996666@s.whatsapp.net', fromMe: false, id: 'BAILEYS_LOC_1' },
            pushName: 'Cliente Localização',
            message: { locationMessage: { degreesLatitude: -3.119, degreesLongitude: -60.021 } },
          },
        ],
      });

      expect(saveMediaFile).not.toHaveBeenCalled();
      expect(baileysLib.downloadMediaMessage).not.toHaveBeenCalled();
      expect(ingestInboundMessage).toHaveBeenCalledWith({
        channelId: 'channel-3',
        fromPhoneNumber: '5511999996666',
        contactDisplayName: 'Cliente Localização',
        whatsappMessageId: 'BAILEYS_LOC_1',
        messageType: 'location',
        locationLatitude: -3.119,
        locationLongitude: -60.021,
      });
    });
  });

  describe('parseBaileysStatusUpdates', () => {
    test('maps DELIVERY_ACK to delivered', () => {
      const result = manager.parseBaileysStatusUpdates([{ key: { id: 'wamid.A' }, update: { status: 3 } }]);
      expect(result).toEqual([{ whatsappMessageId: 'wamid.A', status: 'delivered' }]);
    });

    test('maps READ to read', () => {
      const result = manager.parseBaileysStatusUpdates([{ key: { id: 'wamid.B' }, update: { status: 4 } }]);
      expect(result).toEqual([{ whatsappMessageId: 'wamid.B', status: 'read' }]);
    });

    test('maps PLAYED to read', () => {
      const result = manager.parseBaileysStatusUpdates([{ key: { id: 'wamid.C' }, update: { status: 5 } }]);
      expect(result).toEqual([{ whatsappMessageId: 'wamid.C', status: 'read' }]);
    });

    test('maps ERROR to failed', () => {
      const result = manager.parseBaileysStatusUpdates([{ key: { id: 'wamid.D' }, update: { status: 0 } }]);
      expect(result).toEqual([{ whatsappMessageId: 'wamid.D', status: 'failed' }]);
    });

    test('ignores PENDING and SERVER_ACK (no new information over our own default)', () => {
      const result = manager.parseBaileysStatusUpdates([
        { key: { id: 'wamid.E' }, update: { status: 1 } },
        { key: { id: 'wamid.F' }, update: { status: 2 } },
      ]);
      expect(result).toEqual([]);
    });

    test('ignores an update with no status field (e.g. a message-content edit)', () => {
      const result = manager.parseBaileysStatusUpdates([{ key: { id: 'wamid.G' }, update: { message: { conversation: 'edited' } } }]);
      expect(result).toEqual([]);
    });

    test('ignores an update with no key id', () => {
      const result = manager.parseBaileysStatusUpdates([{ key: {}, update: { status: 3 } }]);
      expect(result).toEqual([]);
    });

    test('processes every update in the batch', () => {
      const result = manager.parseBaileysStatusUpdates([
        { key: { id: 'wamid.A' }, update: { status: 3 } },
        { key: { id: 'wamid.B' }, update: { status: 4 } },
      ]);
      expect(result).toEqual([
        { whatsappMessageId: 'wamid.A', status: 'delivered' },
        { whatsappMessageId: 'wamid.B', status: 'read' },
      ]);
    });
  });

  describe('messages.update handling', () => {
    let sock;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-status-1', type: 'baileys' });
    });

    test('parses the Baileys event and applies the resulting status updates', async () => {
      await sock.handlers['messages.update']([{ key: { id: 'wamid.DELIVERED1' }, update: { status: 3 } }]);

      expect(applyParsedMessageStatusUpdates).toHaveBeenCalledWith([{ whatsappMessageId: 'wamid.DELIVERED1', status: 'delivered' }]);
    });

    test('does not throw when applyParsedMessageStatusUpdates rejects', async () => {
      applyParsedMessageStatusUpdates.mockRejectedValue(new Error('db error'));

      await expect(
        sock.handlers['messages.update']([{ key: { id: 'wamid.X' }, update: { status: 3 } }])
      ).resolves.not.toThrow();
    });
  });

  describe('contact avatar fetching', () => {
    let sock;

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-avatar', type: 'baileys' });
    });

    async function flushAvatarFetch() {
      // The avatar fetch is fire-and-forget (never awaited by handleMessagesUpsert),
      // so its own promise chain (profilePictureUrl -> axios.get -> saveMediaFile ->
      // setContactAvatarPath) needs a macrotask tick to fully settle before assertions.
      await new Promise((resolve) => setImmediate(resolve));
    }

    test('fetches and stores the avatar when the inbound message created a brand-new contact', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-1' }, contactJustCreated: true });
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/fake-avatar.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('fake-avatar-bytes') });
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-avatar.jpg');

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'AVATAR_MSG_1' },
            pushName: 'Cliente Novo',
            message: { conversation: 'Primeira mensagem' },
          },
        ],
      });
      await flushAvatarFetch();

      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999998888@s.whatsapp.net', 'image');
      expect(axios.get).toHaveBeenCalledWith('https://pps.whatsapp.net/fake-avatar.jpg', { responseType: 'arraybuffer' });
      expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-avatar-bytes'), '.jpg');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-new-1', 'generated-avatar.jpg');
    });

    test('does not fetch an avatar when the contact already existed', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-existing-1' }, contactJustCreated: false });

      await sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [
          {
            key: { remoteJid: '5511999997777@s.whatsapp.net', fromMe: false, id: 'AVATAR_MSG_2' },
            pushName: 'Cliente Existente',
            message: { conversation: 'Mensagem de novo' },
          },
        ],
      });
      await flushAvatarFetch();

      expect(sock.profilePictureUrl).not.toHaveBeenCalled();
    });

    test('does not throw and never stores an avatar when the photo is unavailable', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-2' }, contactJustCreated: true });
      sock.profilePictureUrl.mockRejectedValue(new Error('not-authorized'));

      await expect(
        sock.handlers['messages.upsert']({
          type: 'notify',
          messages: [
            {
              key: { remoteJid: '5511999996666@s.whatsapp.net', fromMe: false, id: 'AVATAR_MSG_3' },
              pushName: 'Cliente Privado',
              message: { conversation: 'Oi' },
            },
          ],
        })
      ).resolves.not.toThrow();
      await flushAvatarFetch();

      expect(setContactAvatarPath).not.toHaveBeenCalled();
    });
  });

  describe('sendTextMessage', () => {
    test('sends a text message through the active socket and returns the WhatsApp message id', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.sendTextMessage(channel, '5511999993333', 'Resposta via Baileys');

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', { text: 'Resposta via Baileys' });
      expect(result).toEqual({ whatsappMessageId: 'wamid.SENT1' });
    });

    test('sends a quoted reply when reply context is provided', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.sendTextMessage(channel, '5511999993333', 'R$150,00', {
        repliedToWhatsappMessageId: 'wamid.ORIG1',
        repliedToDirection: 'inbound',
        repliedToContent: 'Qual o valor?',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '5511999993333@s.whatsapp.net',
        { text: 'R$150,00' },
        { quoted: { key: { remoteJid: '5511999993333@s.whatsapp.net', id: 'wamid.ORIG1', fromMe: false }, message: { conversation: 'Qual o valor?' } } }
      );
    });

    test('sends without a quoted reply when repliedToContent is missing (defensive, should not block the send)', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.sendTextMessage(channel, '5511999993333', 'R$150,00', {
        repliedToWhatsappMessageId: 'wamid.ORIG1',
        repliedToDirection: 'inbound',
        repliedToContent: null,
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', { text: 'R$150,00' });
    });

    test('marks fromMe true when replying to an outbound message', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.sendTextMessage(channel, '5511999993333', 'Confirmado', {
        repliedToWhatsappMessageId: 'wamid.ORIG2',
        repliedToDirection: 'outbound',
        repliedToContent: 'Já registramos o pagamento',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '5511999993333@s.whatsapp.net',
        { text: 'Confirmado' },
        expect.objectContaining({ quoted: expect.objectContaining({ key: expect.objectContaining({ fromMe: true }) }) })
      );
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.sendTextMessage({ id: 'channel-does-not-exist' }, '5511999992222', 'Oi')
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });

  describe('resolveWhatsAppJid', () => {
    test('resolves to the canonical phone number WhatsApp reports for the number', async () => {
      const sock = createMockSock();
      sock.onWhatsApp.mockResolvedValue([{ jid: '559885120338@s.whatsapp.net', exists: true }]);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-onwa-1', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.resolveWhatsAppJid(channel, '5598985120338');

      expect(sock.onWhatsApp).toHaveBeenCalledWith('5598985120338');
      expect(result).toBe('559885120338');
    });

    test('returns null when the number is not registered on WhatsApp', async () => {
      const sock = createMockSock();
      sock.onWhatsApp.mockResolvedValue([]);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-onwa-2', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.resolveWhatsAppJid(channel, '5511900000000');

      expect(result).toBeNull();
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.resolveWhatsAppJid({ id: 'channel-does-not-exist' }, '5511999992222')
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });

  describe('fetchContactAvatarForChannel', () => {
    test('fetches through the active connection for the channel', async () => {
      const sock = createMockSock();
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/fake-avatar-2.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('fake-avatar-bytes-2') });
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-avatar-2.jpg');
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-backfill-1', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.fetchContactAvatarForChannel(channel, 'contact-backfill-1', '5511999995555');

      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999995555@s.whatsapp.net', 'image');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-backfill-1', 'generated-avatar-2.jpg');
      expect(result).toBe(true);
    });

    test('resolves to false when the photo is unavailable, without throwing', async () => {
      const sock = createMockSock();
      sock.profilePictureUrl.mockRejectedValue(new Error('item-not-found'));
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-backfill-2', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.fetchContactAvatarForChannel(channel, 'contact-backfill-2', '5511999995556');

      expect(result).toBe(false);
      expect(setContactAvatarPath).not.toHaveBeenCalled();
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.fetchContactAvatarForChannel({ id: 'channel-does-not-exist' }, 'contact-x', '5511999992222')
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });

  describe('sendMediaMessage', () => {
    test('sends an image with a caption through the active socket', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-5', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/image.jpg');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes'));

      const result = await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'image',
        mediaPath: 'image.jpg',
        mediaMimeType: 'image/jpeg',
        caption: 'Resposta do atendente',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        image: Buffer.from('fake-image-bytes'),
        caption: 'Resposta do atendente',
      });
      expect(result).toEqual({ whatsappMessageId: 'wamid.SENT1' });
    });

    test('sends a document with a filename and no caption', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-6', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/doc.pdf');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-doc-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'document',
        mediaPath: 'doc.pdf',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'resposta.pdf',
        caption: null,
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        document: Buffer.from('fake-doc-bytes'),
        mimetype: 'application/pdf',
        fileName: 'resposta.pdf',
      });
    });

    test('sends a video with a caption through the active socket', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-7', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/video.mp4');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-video-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'video',
        mediaPath: 'video.mp4',
        mediaMimeType: 'video/mp4',
        caption: 'Confira o video',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        video: Buffer.from('fake-video-bytes'),
        caption: 'Confira o video',
      });
    });

    test('sends an audio message without a caption', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-8', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/audio.ogg');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-audio-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'audio',
        mediaPath: 'audio.ogg',
        mediaMimeType: 'audio/ogg',
        caption: 'Isso nao deveria aparecer',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        audio: Buffer.from('fake-audio-bytes'),
        mimetype: 'audio/ogg',
      });
    });

    test('sends a browser voice recording as a WhatsApp voice note', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-8b', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/gravacao.ogg');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-audio-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'audio',
        mediaPath: 'gravacao.ogg',
        mediaMimeType: 'audio/ogg; codecs=opus',
        isVoiceNote: true,
      });

      // ptt is what makes WhatsApp treat it as a voice note: it renders as one and, unlike
      // a plain audio attachment, the recipient's app fetches it on arrival instead of
      // leaving it to auto-download settings.
      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        audio: Buffer.from('fake-audio-bytes'),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      });
    });

    test('sends a sticker without a caption', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-9', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/sticker.webp');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-sticker-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'sticker',
        mediaPath: 'sticker.webp',
        mediaMimeType: 'image/webp',
        caption: 'Isso nao deveria aparecer',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        sticker: Buffer.from('fake-sticker-bytes'),
      });
    });

    test('sends a document with a caption included in the payload', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-10', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/doc.pdf');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-doc-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'document',
        mediaPath: 'doc.pdf',
        mediaMimeType: 'application/pdf',
        mediaFilename: 'resposta.pdf',
        caption: 'Segue o documento solicitado',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith('5511999993333@s.whatsapp.net', {
        document: Buffer.from('fake-doc-bytes'),
        mimetype: 'application/pdf',
        fileName: 'resposta.pdf',
        caption: 'Segue o documento solicitado',
      });
    });

    test('sends a quoted reply when reply context is provided', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-5', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/image.jpg');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes'));

      await manager.sendMediaMessage(channel, '5511999993333', {
        messageType: 'image',
        mediaPath: 'image.jpg',
        mediaMimeType: 'image/jpeg',
        caption: 'Segue o comprovante',
        repliedToWhatsappMessageId: 'wamid.ORIG3',
        repliedToDirection: 'inbound',
        repliedToContent: 'Manda o comprovante',
      });

      expect(sock.sendMessage).toHaveBeenCalledWith(
        '5511999993333@s.whatsapp.net',
        { image: Buffer.from('fake-image-bytes'), caption: 'Segue o comprovante' },
        { quoted: { key: { remoteJid: '5511999993333@s.whatsapp.net', id: 'wamid.ORIG3', fromMe: false }, message: { conversation: 'Manda o comprovante' } } }
      );
    });

    test('rejects for an unsupported media message type', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-11', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      const { getMediaFilePath } = require('../media/media-storage');
      getMediaFilePath.mockReturnValue('/fake/path/file.bin');
      const fs = require('fs');
      fs.promises.readFile = jest.fn().mockResolvedValue(Buffer.from('fake-bytes'));

      await expect(
        manager.sendMediaMessage(channel, '5511999993333', {
          messageType: 'foo',
          mediaPath: 'file.bin',
          mediaMimeType: 'application/octet-stream',
        })
      ).rejects.toThrow('Unsupported media message type: foo');
    });

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.sendMediaMessage({ id: 'channel-does-not-exist' }, '5511999992222', { messageType: 'image', mediaPath: 'x.jpg' })
      ).rejects.toThrow('No active Baileys connection for channel channel-does-not-exist');
    });
  });

  describe('addBaileysChannel', () => {
    test('creates the channel row and starts its connection', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      createChannel.mockResolvedValue({
        id: 'channel-5',
        type: 'baileys',
        name: 'WhatsApp Vendas',
        phoneNumber: '+5511988887777',
      });

      const channel = await manager.addBaileysChannel({ name: 'WhatsApp Vendas', phoneNumber: '+5511988887777' });

      expect(createChannel).toHaveBeenCalledWith({
        type: 'baileys',
        name: 'WhatsApp Vendas',
        phoneNumber: '+5511988887777',
        config: {},
      });
      expect(baileysLib.default).toHaveBeenCalled();
      expect(channel).toEqual({
        id: 'channel-5',
        type: 'baileys',
        name: 'WhatsApp Vendas',
        phoneNumber: '+5511988887777',
      });
    });
  });

  describe('startAllBaileysConnections', () => {
    test('starts a connection for every baileys channel and skips meta_cloud channels', async () => {
      const sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      listChannels.mockResolvedValue([
        { id: 'channel-6', type: 'baileys' },
        { id: 'channel-7', type: 'meta_cloud' },
        { id: 'channel-8', type: 'baileys' },
      ]);

      await manager.startAllBaileysConnections();

      expect(baileysLib.default).toHaveBeenCalledTimes(2);
    });
  });
});
