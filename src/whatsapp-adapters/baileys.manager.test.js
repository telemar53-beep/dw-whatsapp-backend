jest.mock('@whiskeysockets/baileys', () => ({
  default: jest.fn(),
  useMultiFileAuthState: jest.fn(),
  DisconnectReason: { loggedOut: 401 },
  downloadMediaMessage: jest.fn(),
}));
jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
}));
jest.mock('../config/env');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    rm: jest.fn().mockResolvedValue(undefined),
  },
}));

const path = require('path');
const fs = require('fs');
const baileysLib = require('@whiskeysockets/baileys');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
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
    handlers,
  };
}

describe('baileys.manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadConfig.mockReturnValue({ baileysSessionsDir: '/sessions' });
    baileysLib.useMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: jest.fn() });
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

    test('throws when there is no active connection for the channel', async () => {
      await expect(
        manager.sendTextMessage({ id: 'channel-does-not-exist' }, '5511999992222', 'Oi')
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
