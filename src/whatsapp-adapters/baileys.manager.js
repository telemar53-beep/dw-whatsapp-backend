const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { saveMediaFile, extensionForMimeType, getMediaFilePath } = require('../media/media-storage');

function loadBaileysLib() {
  return require('@whiskeysockets/baileys');
}

const connections = new Map();

const noopLogger = {
  fatal() {},
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
  child() {
    return noopLogger;
  },
};

function jidToPhoneNumber(jid) {
  return jid.split('@')[0];
}

function extractTextContent(message) {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return message.extendedTextMessage.text;
  }
  return null;
}

function extractMediaInfo(message) {
  if (!message) return null;
  if (message.imageMessage) {
    return { type: 'image', mimeType: message.imageMessage.mimetype, caption: message.imageMessage.caption || null, filename: null };
  }
  if (message.documentMessage) {
    return {
      type: 'document',
      mimeType: message.documentMessage.mimetype,
      caption: message.documentMessage.caption || null,
      filename: message.documentMessage.fileName || null,
    };
  }
  if (message.audioMessage) {
    return { type: 'audio', mimeType: message.audioMessage.mimetype, caption: null, filename: null };
  }
  if (message.videoMessage) {
    return { type: 'video', mimeType: message.videoMessage.mimetype, caption: message.videoMessage.caption || null, filename: null };
  }
  if (message.stickerMessage) {
    return { type: 'sticker', mimeType: message.stickerMessage.mimetype, caption: null, filename: null };
  }
  return null;
}

function extractLocation(message) {
  if (!message || !message.locationMessage) return null;
  return {
    latitude: message.locationMessage.degreesLatitude,
    longitude: message.locationMessage.degreesLongitude,
  };
}

// WhatsApp wraps the real content of disappearing, view-once, and
// captioned-document messages inside one of these envelope types instead
// of exposing imageMessage/audioMessage/etc. directly.
const MESSAGE_WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];

function unwrapMessage(message) {
  let current = message;
  while (current) {
    const wrapperKey = MESSAGE_WRAPPER_KEYS.find((key) => current[key] && current[key].message);
    if (!wrapperKey) break;
    current = current[wrapperKey].message;
  }
  return current;
}

function sessionDirFor(channelId) {
  return path.join(loadConfig().baileysSessionsDir, channelId);
}

async function clearSession(channelId) {
  await fs.promises.rm(sessionDirFor(channelId), { recursive: true, force: true });
}

function resolveContactPhoneJid(key) {
  const jid = key.remoteJid || '';
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) {
    return null;
  }
  if (jid.endsWith('@s.whatsapp.net')) {
    return jid;
  }
  // WhatsApp's privacy-preserving "LID" addressing (@lid) replaces the
  // phone-number JID for some contacts. Baileys exposes the traditional
  // phone-number JID (when known) via remoteJidAlt.
  if (key.remoteJidAlt && key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
    return key.remoteJidAlt;
  }
  return null;
}

async function handleMessagesUpsert(channel, { messages, type }) {
  if (type !== 'notify') return;
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    const phoneJid = resolveContactPhoneJid(msg.key);
    if (!phoneJid) continue;
    const fromPhoneNumber = jidToPhoneNumber(phoneJid);
    const contactDisplayName = msg.pushName ? msg.pushName.trim() : null;
    const innerMessage = unwrapMessage(msg.message);

    const location = extractLocation(innerMessage);
    if (location) {
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: 'location',
        locationLatitude: location.latitude,
        locationLongitude: location.longitude,
      });
      continue;
    }

    const mediaInfo = extractMediaInfo(innerMessage);
    if (mediaInfo) {
      const { downloadMediaMessage } = loadBaileysLib();
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mediaPath = await saveMediaFile(buffer, extensionForMimeType(mediaInfo.mimeType));
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: mediaInfo.type,
        content: mediaInfo.caption,
        mediaPath,
        mediaMimeType: mediaInfo.mimeType,
        mediaFilename: mediaInfo.filename,
      });
      continue;
    }

    const content = extractTextContent(innerMessage);
    if (!content) {
      console.log(
        `Unrecognized Baileys message type for channel ${channel.id}, keys: ${
          innerMessage ? Object.keys(innerMessage).join(', ') : '(no message)'
        }`
      );
      continue;
    }
    await ingestInboundMessage({
      channelId: channel.id,
      fromPhoneNumber,
      contactDisplayName,
      whatsappMessageId: msg.key.id,
      messageType: 'text',
      content,
    });
  }
}

async function handleConnectionUpdate(channel, update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    const entry = connections.get(channel.id);
    if (entry) entry.qr = qr;
    await updateChannelStatus(channel.id, 'awaiting_qr');
    return;
  }

  if (connection === 'open') {
    const entry = connections.get(channel.id);
    if (entry) entry.qr = null;
    await updateChannelStatus(channel.id, 'connected');
    return;
  }

  if (connection === 'close') {
    const statusCode =
      lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : null;
    if (statusCode === loadBaileysLib().DisconnectReason.loggedOut) {
      connections.delete(channel.id);
      await updateChannelStatus(channel.id, 'disconnected');
      await clearSession(channel.id);
    } else {
      closeExistingSocket(channel.id);
      await startBaileysConnection(channel);
    }
  }
}

function closeExistingSocket(channelId) {
  const entry = connections.get(channelId);
  if (!entry || !entry.sock) return;
  if (entry.sock.ev && typeof entry.sock.ev.removeAllListeners === 'function') {
    entry.sock.ev.removeAllListeners();
  }
  if (typeof entry.sock.end === 'function') {
    entry.sock.end(undefined);
  }
}

async function startBaileysConnection(channel) {
  const { default: makeWASocket, useMultiFileAuthState } = loadBaileysLib();
  const { state, saveCreds } = await useMultiFileAuthState(sessionDirFor(channel.id));
  const sock = makeWASocket({ auth: state, logger: noopLogger, printQRInTerminal: false });
  connections.set(channel.id, { sock, qr: null });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => {
    handleConnectionUpdate(channel, update).catch((err) => {
      console.error(`Failed to handle connection update for channel ${channel.id}`, err);
    });
  });
  sock.ev.on('messages.upsert', (payload) => {
    return handleMessagesUpsert(channel, payload).catch((err) => {
      console.error(`Failed to handle inbound Baileys message for channel ${channel.id}`, err);
    });
  });
  return sock;
}

async function startAllBaileysConnections() {
  const channels = await listChannels();
  for (const channel of channels.filter((c) => c.type === 'baileys')) {
    try {
      await startBaileysConnection(channel);
    } catch (err) {
      console.error(`Failed to start Baileys connection for channel ${channel.id}`, err);
    }
  }
}

async function addBaileysChannel({ name, phoneNumber }) {
  const channel = await createChannel({ type: 'baileys', name, phoneNumber, config: {} });
  await startBaileysConnection(channel);
  return channel;
}

async function sendTextMessage(channel, toPhoneNumber, content) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const sent = await entry.sock.sendMessage(`${toPhoneNumber}@s.whatsapp.net`, { text: content });
  return { whatsappMessageId: sent.key.id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption }) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));
  const jid = `${toPhoneNumber}@s.whatsapp.net`;

  let payload;
  if (messageType === 'image') {
    payload = caption ? { image: buffer, caption } : { image: buffer };
  } else if (messageType === 'video') {
    payload = caption ? { video: buffer, caption } : { video: buffer };
  } else if (messageType === 'audio') {
    payload = { audio: buffer, mimetype: mediaMimeType };
  } else if (messageType === 'document') {
    payload = caption
      ? { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo', caption }
      : { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo' };
  } else if (messageType === 'sticker') {
    payload = { sticker: buffer };
  } else {
    throw new Error(`Unsupported media message type: ${messageType}`);
  }

  const sent = await entry.sock.sendMessage(jid, payload);
  return { whatsappMessageId: sent.key.id };
}

function getQrForChannel(channelId) {
  const entry = connections.get(channelId);
  return entry ? entry.qr : null;
}

module.exports = {
  startAllBaileysConnections,
  startBaileysConnection,
  addBaileysChannel,
  sendTextMessage,
  sendMediaMessage,
  getQrForChannel,
};
