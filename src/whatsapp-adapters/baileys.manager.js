const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');

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

function sessionDirFor(channelId) {
  return path.join(loadConfig().baileysSessionsDir, channelId);
}

async function clearSession(channelId) {
  await fs.promises.rm(sessionDirFor(channelId), { recursive: true, force: true });
}

async function handleMessagesUpsert(channel, { messages, type }) {
  if (type !== 'notify') return;
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith('@s.whatsapp.net')) continue;
    const content = extractTextContent(msg.message);
    if (!content) continue;
    await ingestInboundMessage({
      channelId: channel.id,
      fromPhoneNumber: jidToPhoneNumber(msg.key.remoteJid),
      contactDisplayName: msg.pushName || null,
      whatsappMessageId: msg.key.id,
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
    handleMessagesUpsert(channel, payload).catch((err) => {
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

function getQrForChannel(channelId) {
  const entry = connections.get(channelId);
  return entry ? entry.qr : null;
}

module.exports = {
  startAllBaileysConnections,
  startBaileysConnection,
  addBaileysChannel,
  sendTextMessage,
  getQrForChannel,
};
