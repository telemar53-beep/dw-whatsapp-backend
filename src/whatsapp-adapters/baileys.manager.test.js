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
  deleteMediaFile: jest.fn().mockResolvedValue(undefined),
  getMediaFilePath: jest.fn(),
}));
jest.mock('../realtime/socket-server');
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
const { setContactAvatarPath, claimContactAvatarRefresh, findContactByPhoneNumber } = require('../conversations/contact.repository');
const { applyParsedMessageStatusUpdates } = require('../conversations/message-status.service');
const { broadcast } = require('../realtime/socket-server');
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
    // Por padrão o contato ainda não foi conferido: a trava libera a busca.
    claimContactAvatarRefresh.mockImplementation(async (contactId) => ({ id: contactId, avatarPath: null }));
    findContactByPhoneNumber.mockResolvedValue(null);
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
      expect(sock.ev.on).toHaveBeenCalledWith('contacts.update', expect.any(Function));
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

  describe('contact avatar refresh', () => {
    let sock;
    const { saveMediaFile, deleteMediaFile } = require('../media/media-storage');

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-avatar', type: 'baileys' });
    });

    async function flushAvatarFetch() {
      // The avatar refresh is fire-and-forget (never awaited by handleMessagesUpsert),
      // so its own promise chain (claim -> profilePictureUrl -> axios.get -> saveMediaFile ->
      // setContactAvatarPath) needs a macrotask tick to fully settle before assertions.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    }

    function inbound(jid, id, text = 'Oi') {
      return sock.handlers['messages.upsert']({
        type: 'notify',
        messages: [{ key: { remoteJid: jid, fromMe: false, id }, pushName: 'Cliente', message: { conversation: text } }],
      });
    }

    test('fetches and stores the avatar when the inbound message created a brand-new contact', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-1' }, contactJustCreated: true });
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/fake-avatar.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('fake-avatar-bytes') });
      saveMediaFile.mockResolvedValue('generated-avatar.jpg');

      await inbound('5511999998888@s.whatsapp.net', 'AVATAR_MSG_1', 'Primeira mensagem');
      await flushAvatarFetch();

      expect(claimContactAvatarRefresh).toHaveBeenCalledWith('contact-new-1', manager.AVATAR_REFRESH_INTERVAL_MS);
      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999998888@s.whatsapp.net', 'image');
      expect(axios.get).toHaveBeenCalledWith('https://pps.whatsapp.net/fake-avatar.jpg', { responseType: 'arraybuffer' });
      expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-avatar-bytes'), '.jpg');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-new-1', 'generated-avatar.jpg');
      expect(broadcast).toHaveBeenCalledWith('contact:avatar-updated', { contactId: 'contact-new-1', avatarPath: 'generated-avatar.jpg' });
      expect(deleteMediaFile).not.toHaveBeenCalled();
    });

    test('re-checks an existing contact whose last check is stale and replaces the old photo', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-existing-1' }, contactJustCreated: false });
      claimContactAvatarRefresh.mockResolvedValue({ id: 'contact-existing-1', avatarPath: 'old-avatar.jpg' });
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/new-avatar.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('new-bytes') });
      saveMediaFile.mockResolvedValue('new-avatar.jpg');

      await inbound('5511999997777@s.whatsapp.net', 'AVATAR_MSG_2');
      await flushAvatarFetch();

      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-existing-1', 'new-avatar.jpg');
      expect(broadcast).toHaveBeenCalledWith('contact:avatar-updated', { contactId: 'contact-existing-1', avatarPath: 'new-avatar.jpg' });
      expect(deleteMediaFile).toHaveBeenCalledWith('old-avatar.jpg');
    });

    test('does not ask WhatsApp again when the contact was checked recently (claim refused)', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-existing-2' }, contactJustCreated: false });
      claimContactAvatarRefresh.mockResolvedValue(null);

      await inbound('5511999997778@s.whatsapp.net', 'AVATAR_MSG_2B');
      await flushAvatarFetch();

      expect(claimContactAvatarRefresh).toHaveBeenCalledWith('contact-existing-2', manager.AVATAR_REFRESH_INTERVAL_MS);
      expect(sock.profilePictureUrl).not.toHaveBeenCalled();
      expect(setContactAvatarPath).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    test('clears the stored photo when the contact removed it (or made it private)', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-existing-3' }, contactJustCreated: false });
      claimContactAvatarRefresh.mockResolvedValue({ id: 'contact-existing-3', avatarPath: 'old-avatar.jpg' });
      const err = new Error('not-authorized');
      err.data = 401;
      sock.profilePictureUrl.mockRejectedValue(err);

      await inbound('5511999997779@s.whatsapp.net', 'AVATAR_MSG_2C');
      await flushAvatarFetch();

      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-existing-3', null);
      expect(broadcast).toHaveBeenCalledWith('contact:avatar-updated', { contactId: 'contact-existing-3', avatarPath: null });
      expect(deleteMediaFile).toHaveBeenCalledWith('old-avatar.jpg');
    });

    test('keeps the stored photo when the WhatsApp lookup fails for a transient reason', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-existing-4' }, contactJustCreated: false });
      claimContactAvatarRefresh.mockResolvedValue({ id: 'contact-existing-4', avatarPath: 'old-avatar.jpg' });
      sock.profilePictureUrl.mockRejectedValue(new Error('Timed Out'));

      await inbound('5511999997780@s.whatsapp.net', 'AVATAR_MSG_2D');
      await flushAvatarFetch();

      expect(setContactAvatarPath).not.toHaveBeenCalled();
      expect(deleteMediaFile).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    test('does not throw and never stores an avatar when a new contact has no photo', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-2' }, contactJustCreated: true });
      sock.profilePictureUrl.mockRejectedValue(new Error('not-authorized'));

      await expect(inbound('5511999996666@s.whatsapp.net', 'AVATAR_MSG_3')).resolves.not.toThrow();
      await flushAvatarFetch();

      expect(setContactAvatarPath).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    test('still processes the message when the claim itself fails', async () => {
      ingestInboundMessage.mockResolvedValue({ contact: { id: 'contact-new-3' }, contactJustCreated: true });
      claimContactAvatarRefresh.mockRejectedValue(new Error('db down'));

      await expect(inbound('5511999996667@s.whatsapp.net', 'AVATAR_MSG_4')).resolves.not.toThrow();
      await flushAvatarFetch();

      expect(ingestInboundMessage).toHaveBeenCalled();
      expect(sock.profilePictureUrl).not.toHaveBeenCalled();
    });
  });

  describe('contacts.update (profile picture changed on WhatsApp)', () => {
    let sock;
    const channel = { id: 'channel-picture', type: 'baileys' };
    const { saveMediaFile, deleteMediaFile } = require('../media/media-storage');

    beforeEach(async () => {
      sock = createMockSock();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection(channel);
    });

    async function flush() {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    }

    test('forces a refresh (ignoring the interval) for a known contact whose picture changed', async () => {
      findContactByPhoneNumber.mockResolvedValue({ id: 'contact-known', phoneNumber: '5511999990001', avatarPath: 'old.jpg' });
      claimContactAvatarRefresh.mockResolvedValue({ id: 'contact-known', avatarPath: 'old.jpg' });
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/changed.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('changed-bytes') });
      saveMediaFile.mockResolvedValue('changed.jpg');

      await sock.handlers['contacts.update']([{ id: '5511999990001@s.whatsapp.net', imgUrl: 'changed' }]);
      await flush();

      expect(findContactByPhoneNumber).toHaveBeenCalledWith('5511999990001');
      expect(claimContactAvatarRefresh).toHaveBeenCalledWith('contact-known', 0);
      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999990001@s.whatsapp.net', 'image');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-known', 'changed.jpg');
      expect(deleteMediaFile).toHaveBeenCalledWith('old.jpg');
      expect(broadcast).toHaveBeenCalledWith('contact:avatar-updated', { contactId: 'contact-known', avatarPath: 'changed.jpg' });
    });

    test('clears the photo for a known contact whose picture was removed', async () => {
      findContactByPhoneNumber.mockResolvedValue({ id: 'contact-known', phoneNumber: '5511999990001', avatarPath: 'old.jpg' });
      claimContactAvatarRefresh.mockResolvedValue({ id: 'contact-known', avatarPath: 'old.jpg' });
      sock.profilePictureUrl.mockResolvedValue(undefined);

      await sock.handlers['contacts.update']([{ id: '5511999990001@s.whatsapp.net', imgUrl: 'removed' }]);
      await flush();

      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-known', null);
      expect(deleteMediaFile).toHaveBeenCalledWith('old.jpg');
      expect(broadcast).toHaveBeenCalledWith('contact:avatar-updated', { contactId: 'contact-known', avatarPath: null });
    });

    test('resolves a LID address through the socket mapping before looking the contact up', async () => {
      sock.signalRepository = { lidMapping: { getPNForLID: jest.fn().mockResolvedValue('5511999990002@s.whatsapp.net') } };
      findContactByPhoneNumber.mockResolvedValue({ id: 'contact-lid', phoneNumber: '5511999990002', avatarPath: null });
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/lid.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('lid-bytes') });
      saveMediaFile.mockResolvedValue('lid.jpg');

      await sock.handlers['contacts.update']([{ id: '123456789@lid', imgUrl: 'changed' }]);
      await flush();

      expect(sock.signalRepository.lidMapping.getPNForLID).toHaveBeenCalledWith('123456789@lid');
      expect(findContactByPhoneNumber).toHaveBeenCalledWith('5511999990002');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-lid', 'lid.jpg');
    });

    test('ignores updates without a picture change, unknown contacts and unresolvable ids', async () => {
      findContactByPhoneNumber.mockResolvedValue(null);

      await sock.handlers['contacts.update']([
        { id: '5511999990003@s.whatsapp.net', notify: 'Novo nome' },
        { id: '5511999990004@s.whatsapp.net', imgUrl: 'changed' },
        { id: '987654321@lid', imgUrl: 'changed' },
        { id: 'grupo@g.us', imgUrl: 'changed' },
      ]);
      await flush();

      expect(findContactByPhoneNumber).toHaveBeenCalledTimes(1);
      expect(findContactByPhoneNumber).toHaveBeenCalledWith('5511999990004');
      expect(sock.profilePictureUrl).not.toHaveBeenCalled();
    });

    test('never rejects even when the lookup throws', async () => {
      findContactByPhoneNumber.mockRejectedValue(new Error('db down'));
      await expect(
        sock.handlers['contacts.update']([{ id: '5511999990005@s.whatsapp.net', imgUrl: 'changed' }])
      ).resolves.not.toThrow();
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

      expect(claimContactAvatarRefresh).toHaveBeenCalledWith('contact-backfill-1', manager.AVATAR_REFRESH_INTERVAL_MS);
      expect(sock.profilePictureUrl).toHaveBeenCalledWith('5511999995555@s.whatsapp.net', 'image');
      expect(setContactAvatarPath).toHaveBeenCalledWith('contact-backfill-1', 'generated-avatar-2.jpg');
      expect(result).toBe(true);
    });

    test('force bypasses the refresh interval (used by the backfill script)', async () => {
      const sock = createMockSock();
      sock.profilePictureUrl.mockResolvedValue('https://pps.whatsapp.net/fake-avatar-3.jpg');
      axios.get.mockResolvedValue({ data: Buffer.from('fake-avatar-bytes-3') });
      const { saveMediaFile } = require('../media/media-storage');
      saveMediaFile.mockResolvedValue('generated-avatar-3.jpg');
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-backfill-3', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      await manager.fetchContactAvatarForChannel(channel, 'contact-backfill-3', '5511999995557', { force: true });

      expect(claimContactAvatarRefresh).toHaveBeenCalledWith('contact-backfill-3', 0);
    });

    test('resolves to false without asking WhatsApp when the contact was checked recently', async () => {
      const sock = createMockSock();
      claimContactAvatarRefresh.mockResolvedValue(null);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-backfill-4', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.fetchContactAvatarForChannel(channel, 'contact-backfill-4', '5511999995558');

      expect(result).toBe(false);
      expect(sock.profilePictureUrl).not.toHaveBeenCalled();
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

  describe('verifyMediaDelivery', () => {
    function createMockSockWithRetryManager(cachedMessage) {
      const sock = createMockSock();
      sock.messageRetryManager = { getRecentMessage: jest.fn().mockReturnValue(cachedMessage) };
      sock.updateMediaMessage = jest.fn();
      return sock;
    }

    test('returns verified:true when the just-sent audio can be downloaded back', async () => {
      const cached = { message: { audioMessage: { url: 'https://mmg.whatsapp.net/x', mediaKey: 'key' } } };
      const sock = createMockSockWithRetryManager(cached);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-20', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      baileysLib.downloadMediaMessage.mockResolvedValue(Buffer.from('the-audio-bytes'));

      const result = await manager.verifyMediaDelivery(channel, 'wamid.AUDIO1', '5511999993333');

      expect(result).toEqual({ verified: true });
      expect(baileysLib.downloadMediaMessage).toHaveBeenCalledWith(
        { key: { remoteJid: '5511999993333@s.whatsapp.net', id: 'wamid.AUDIO1', fromMe: true }, message: cached.message },
        'buffer',
        {},
        expect.objectContaining({ reuploadRequest: sock.updateMediaMessage })
      );
    });

    test('returns verified:false when the download keeps failing', async () => {
      const cached = { message: { audioMessage: { url: 'https://mmg.whatsapp.net/x', mediaKey: 'key' } } };
      const sock = createMockSockWithRetryManager(cached);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-21', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      baileysLib.downloadMediaMessage.mockRejectedValue(new Error('Media re-upload failed by device (OTHER)'));

      const result = await manager.verifyMediaDelivery(channel, 'wamid.AUDIO2', '5511999993333');

      expect(result).toEqual({ verified: false, reason: 'Media re-upload failed by device (OTHER)' });
    });

    test('returns verified:null when the message is no longer in the retry cache', async () => {
      const sock = createMockSockWithRetryManager(undefined);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-22', type: 'baileys' };
      await manager.startBaileysConnection(channel);

      const result = await manager.verifyMediaDelivery(channel, 'wamid.AUDIO3', '5511999993333');

      expect(result).toEqual({ verified: null, reason: 'not-cached' });
      expect(baileysLib.downloadMediaMessage).not.toHaveBeenCalled();
    });

    test('returns verified:false when the check itself times out', async () => {
      const cached = { message: { audioMessage: { url: 'https://mmg.whatsapp.net/x', mediaKey: 'key' } } };
      const sock = createMockSockWithRetryManager(cached);
      baileysLib.default.mockReturnValue(sock);
      const channel = { id: 'channel-23', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      baileysLib.downloadMediaMessage.mockReturnValue(new Promise(() => {})); // never resolves

      const result = await manager.verifyMediaDelivery(channel, 'wamid.AUDIO4', '5511999993333', { timeoutMs: 10 });

      expect(result).toEqual({ verified: false, reason: 'timed out' });
    });

    test('returns verified:null when there is no active connection for the channel', async () => {
      const result = await manager.verifyMediaDelivery({ id: 'channel-does-not-exist' }, 'wamid.X', '5511999993333');

      expect(result).toEqual({ verified: null, reason: 'no-connection' });
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

  describe('stopBaileysChannel', () => {
    test('closes the live socket and clears the stored session', async () => {
      const sock = createMockSock();
      sock.end = jest.fn();
      sock.ev.removeAllListeners = jest.fn();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-stop-1', type: 'baileys' });

      await manager.stopBaileysChannel('channel-stop-1');

      expect(sock.ev.removeAllListeners).toHaveBeenCalled();
      expect(sock.end).toHaveBeenCalled();
      expect(fs.promises.rm).toHaveBeenCalledWith(path.join('/sessions', 'channel-stop-1'), { recursive: true, force: true });
    });

    test('clears the session even when there is no live socket for the channel', async () => {
      await manager.stopBaileysChannel('channel-never-started');

      expect(fs.promises.rm).toHaveBeenCalledWith(path.join('/sessions', 'channel-never-started'), {
        recursive: true,
        force: true,
      });
    });

    test('drops the channel from the connection map, so no QR is served for it anymore', async () => {
      const sock = createMockSock();
      sock.end = jest.fn();
      sock.ev.removeAllListeners = jest.fn();
      baileysLib.default.mockReturnValue(sock);
      await manager.startBaileysConnection({ id: 'channel-stop-2', type: 'baileys' });

      await manager.stopBaileysChannel('channel-stop-2');

      expect(manager.getQrForChannel('channel-stop-2')).toBeNull();
    });
  });

  describe('reconnectBaileysChannel', () => {
    test('clears the old session and starts a fresh connection, so a new QR is generated', async () => {
      const oldSock = createMockSock();
      oldSock.end = jest.fn();
      oldSock.ev.removeAllListeners = jest.fn();
      baileysLib.default.mockReturnValue(oldSock);
      const channel = { id: 'channel-reconnect-1', type: 'baileys' };
      await manager.startBaileysConnection(channel);
      baileysLib.default.mockClear();

      const newSock = createMockSock();
      baileysLib.default.mockReturnValue(newSock);
      await manager.reconnectBaileysChannel(channel);

      expect(oldSock.end).toHaveBeenCalled();
      expect(fs.promises.rm).toHaveBeenCalledWith(path.join('/sessions', 'channel-reconnect-1'), {
        recursive: true,
        force: true,
      });
      expect(baileysLib.default).toHaveBeenCalledTimes(1);
    });
  });
});
