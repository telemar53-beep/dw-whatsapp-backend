const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { loadConfig } = require('../config/env');
const { createChannel, updateChannelStatus, listChannels } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { setContactAvatarPath, claimContactAvatarRefresh, findContactByPhoneNumber } = require('../conversations/contact.repository');
const { applyParsedMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveMediaFile, deleteMediaFile, extensionForMimeType, getMediaFilePath } = require('../media/media-storage');
const { broadcast } = require('../realtime/socket-server');
const { formatarData, formatarValor } = require('../payments/payment-card');
const { getCompanyConfig } = require('../company/company-config.repository');

function loadBaileysLib() {
  return require('@whiskeysockets/baileys');
}

const connections = new Map();

// Baileys is chatty at info/debug and we don't want that in the service log, but
// silencing it entirely hid a real failure for days: it swallows media problems into a
// warn ("failed to obtain extra info") and sends the message anyway. Keep warn and above.
const noopLogger = {
  fatal(...args) {
    console.error('[baileys]', ...args);
  },
  error(...args) {
    console.error('[baileys]', ...args);
  },
  warn(...args) {
    console.warn('[baileys]', ...args);
  },
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

// proto.WebMessageInfo.Status: ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5.
// PENDING/SERVER_ACK carry no information beyond our own 'sent' default and are ignored.
const STATUS_BY_BAILEYS_CODE = { 0: 'failed', 3: 'delivered', 4: 'read', 5: 'read' };

function parseBaileysStatusUpdates(updates) {
  const result = [];
  for (const { key, update } of updates) {
    if (!key || !key.id || update.status === undefined) continue;
    const status = STATUS_BY_BAILEYS_CODE[update.status];
    if (!status) continue;
    result.push({ whatsappMessageId: key.id, status });
  }
  return result;
}

function extractTextContent(message) {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return message.extendedTextMessage.text;
  }
  // Verified/official WhatsApp Business accounts (banks, delivery, etc.)
  // commonly send button/template/interactive messages instead of plain
  // text. This project has no button-tap support, so only the body text
  // is extracted; the buttons themselves are dropped.
  if (message.buttonsMessage) {
    return message.buttonsMessage.contentText || message.buttonsMessage.text || null;
  }
  if (message.templateMessage) {
    const hydrated = message.templateMessage.hydratedFourRowTemplate || message.templateMessage.hydratedTemplate;
    if (hydrated && hydrated.hydratedContentText) {
      return hydrated.hydratedContentText;
    }
  }
  if (message.interactiveMessage && message.interactiveMessage.body) {
    return message.interactiveMessage.body.text || null;
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
    return {
      type: 'audio',
      mimeType: message.audioMessage.mimetype,
      caption: null,
      filename: null,
      durationSeconds: message.audioMessage.seconds || null,
    };
  }
  if (message.videoMessage) {
    return { type: 'video', mimeType: message.videoMessage.mimetype, caption: message.videoMessage.caption || null, filename: null };
  }
  if (message.stickerMessage) {
    return { type: 'sticker', mimeType: message.stickerMessage.mimetype, caption: null, filename: null };
  }
  return null;
}

// Quando o cliente responde citando uma mensagem, o Baileys guarda o id da
// mensagem citada em contextInfo.stanzaId dentro do nó de conteúdo (varia por
// tipo: extendedTextMessage, imageMessage, audioMessage, etc.) — não existe um
// campo único no nível de `message`. Em vez de listar cada tipo, percorre os
// valores de `message` e devolve o primeiro stanzaId não-vazio que achar.
function extractQuotedMessageId(message) {
  if (!message) return null;
  for (const value of Object.values(message)) {
    if (!value || typeof value !== 'object') continue;
    const stanzaId = value.contextInfo && value.contextInfo.stanzaId;
    if (typeof stanzaId === 'string' && stanzaId) {
      return stanzaId;
    }
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

// Intervalo mínimo entre duas consultas ao WhatsApp pela foto do MESMO contato
// (a cada mensagem recebida). Troca de foto detectada pelo evento
// `contacts.update` ignora esse intervalo e atualiza na hora.
const AVATAR_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

// O WhatsApp responde "não tem foto" de duas formas: URL vazia, ou um erro de
// item-not-found (404) / not-authorized (401, foto privada). Baileys embrulha o
// código do erro num Boom em `err.data`. Qualquer outra falha (rede, timeout,
// conexão caindo) é transitória e NÃO deve apagar a foto que já temos.
function isNoPictureError(err) {
  const code = err && (err.data || (err.output && err.output.statusCode));
  if (code === 401 || code === 403 || code === 404) return true;
  const message = err && err.message ? String(err.message) : '';
  return /not-authorized|item-not-found|forbidden/i.test(message);
}

// Reconsulta a foto de perfil do contato e sincroniza o banco com o WhatsApp:
// foto nova → baixa, troca o arquivo e avisa o frontend; foto removida/privada
// → limpa; nada mudou → só renova a marca de "conferido". Devolve true quando
// o contato passa a ter uma foto ao final. Nunca deixa erro escapar.
async function refreshContactAvatar(sock, phoneJid, contactId, { force = false } = {}) {
  let previous;
  try {
    previous = await claimContactAvatarRefresh(contactId, force ? 0 : AVATAR_REFRESH_INTERVAL_MS);
  } catch (err) {
    console.error(`Could not claim profile photo refresh for contact ${contactId}`, err);
    return false;
  }
  if (!previous) return false;
  const previousPath = previous.avatarPath || null;

  let url = null;
  try {
    url = await sock.profilePictureUrl(phoneJid, 'image');
  } catch (err) {
    if (!isNoPictureError(err)) {
      console.error(`Could not fetch profile photo for contact ${contactId}`, err);
      return Boolean(previousPath);
    }
  }

  try {
    if (!url) {
      if (previousPath) {
        await setContactAvatarPath(contactId, null);
        broadcast('contact:avatar-updated', { contactId, avatarPath: null });
        await deleteMediaFile(previousPath).catch(() => {});
      }
      return false;
    }
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const avatarPath = await saveMediaFile(Buffer.from(response.data), '.jpg');
    await setContactAvatarPath(contactId, avatarPath);
    broadcast('contact:avatar-updated', { contactId, avatarPath });
    if (previousPath && previousPath !== avatarPath) {
      await deleteMediaFile(previousPath).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(`Could not store profile photo for contact ${contactId}`, err);
    return Boolean(previousPath);
  }
}

function scheduleContactAvatarRefresh(channel, entry, phoneJid, contact, options) {
  if (!contact || !contact.id) return;
  if (!entry) {
    console.log(`Skipping avatar refresh for contact ${contact.id}: no active connection for channel ${channel.id}`);
    return;
  }
  refreshContactAvatar(entry.sock, phoneJid, contact.id, options).catch((err) => {
    console.error(`Could not refresh profile photo for contact ${contact.id}`, err);
  });
}

async function fetchContactAvatarForChannel(channel, contactId, phoneNumber, { force = false } = {}) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  return refreshContactAvatar(entry.sock, `${phoneNumber}@s.whatsapp.net`, contactId, { force });
}

async function resolvePhoneJidForContactUpdate(sock, id) {
  if (!id) return null;
  if (id.endsWith('@s.whatsapp.net')) return id;
  if (!id.endsWith('@lid')) return null;
  const mapping = sock.signalRepository && sock.signalRepository.lidMapping;
  if (!mapping || typeof mapping.getPNForLID !== 'function') return null;
  const pn = await mapping.getPNForLID(id);
  return pn && pn.endsWith('@s.whatsapp.net') ? pn : null;
}

// Baileys emite `contacts.update` com imgUrl 'changed' / 'removed' quando o
// WhatsApp avisa que um contato trocou ou apagou a foto de perfil — é o mesmo
// sinal que faz o app do celular atualizar a foto na hora.
async function handleContactsUpdate(channel, updates) {
  const entry = connections.get(channel.id);
  if (!entry) return;
  for (const update of updates || []) {
    if (!update || (update.imgUrl !== 'changed' && update.imgUrl !== 'removed')) continue;
    let phoneJid = null;
    try {
      phoneJid = await resolvePhoneJidForContactUpdate(entry.sock, update.id);
    } catch (err) {
      console.error(`Could not resolve phone JID for contact update ${update.id}`, err);
    }
    if (!phoneJid) continue;
    const contact = await findContactByPhoneNumber(jidToPhoneNumber(phoneJid));
    if (!contact) continue;
    scheduleContactAvatarRefresh(channel, entry, phoneJid, contact, { force: true });
  }
}

async function handleMessagesUpsert(channel, { messages, type }) {
  if (type !== 'notify') return;
  const entry = connections.get(channel.id);
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    const phoneJid = resolveContactPhoneJid(msg.key);
    if (!phoneJid) continue;
    const fromPhoneNumber = jidToPhoneNumber(phoneJid);
    const contactDisplayName = msg.pushName ? msg.pushName.trim() : null;
    const innerMessage = unwrapMessage(msg.message);
    const repliedToWhatsappMessageId = extractQuotedMessageId(innerMessage);

    const location = extractLocation(innerMessage);
    if (location) {
      const result = await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: 'location',
        locationLatitude: location.latitude,
        locationLongitude: location.longitude,
        repliedToWhatsappMessageId,
        sentAt: sentAtFromBaileys(msg.messageTimestamp),
      });
      scheduleContactAvatarRefresh(channel, entry, phoneJid, result.contact);
      continue;
    }

    const mediaInfo = extractMediaInfo(innerMessage);
    if (mediaInfo) {
      const { downloadMediaMessage } = loadBaileysLib();
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mediaPath = await saveMediaFile(buffer, extensionForMimeType(mediaInfo.mimeType));
      const result = await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber,
        contactDisplayName,
        whatsappMessageId: msg.key.id,
        messageType: mediaInfo.type,
        content: mediaInfo.caption,
        mediaPath,
        mediaMimeType: mediaInfo.mimeType,
        mediaFilename: mediaInfo.filename,
        audioDurationSeconds: mediaInfo.durationSeconds || null,
        repliedToWhatsappMessageId,
        sentAt: sentAtFromBaileys(msg.messageTimestamp),
      });
      scheduleContactAvatarRefresh(channel, entry, phoneJid, result.contact);
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
    const result = await ingestInboundMessage({
      channelId: channel.id,
      fromPhoneNumber,
      contactDisplayName,
      whatsappMessageId: msg.key.id,
      messageType: 'text',
      content,
      repliedToWhatsappMessageId,
      sentAt: sentAtFromBaileys(msg.messageTimestamp),
    });
    scheduleContactAvatarRefresh(channel, entry, phoneJid, result.contact);
  }
}

async function handleMessagesUpdate(channel, updates) {
  const parsed = parseBaileysStatusUpdates(updates);
  await applyParsedMessageStatusUpdates(parsed);
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
  sock.ev.on('messages.update', (updates) => {
    return handleMessagesUpdate(channel, updates).catch((err) => {
      console.error(`Failed to handle Baileys message status update for channel ${channel.id}`, err);
    });
  });
  sock.ev.on('contacts.update', (updates) => {
    return handleContactsUpdate(channel, updates).catch((err) => {
      console.error(`Failed to handle Baileys contact update for channel ${channel.id}`, err);
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

async function stopBaileysChannel(channelId) {
  closeExistingSocket(channelId);
  connections.delete(channelId);
  await clearSession(channelId);
}

async function reconnectBaileysChannel(channel) {
  await stopBaileysChannel(channel.id);
  return startBaileysConnection(channel);
}

async function addBaileysChannel({ name, phoneNumber }) {
  const channel = await createChannel({ type: 'baileys', name, phoneNumber, config: {} });
  await startBaileysConnection(channel);
  return channel;
}

function buildQuotedOptions(jid, { repliedToWhatsappMessageId, repliedToDirection, repliedToContent } = {}) {
  if (!repliedToWhatsappMessageId || !repliedToContent) return undefined;
  return {
    quoted: {
      key: { remoteJid: jid, id: repliedToWhatsappMessageId, fromMe: repliedToDirection === 'outbound' },
      message: { conversation: repliedToContent },
    },
  };
}

async function sendTextMessage(channel, toPhoneNumber, content, replyContext = {}) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const jid = `${toPhoneNumber}@s.whatsapp.net`;
  const options = buildQuotedOptions(jid, replyContext);
  const sent = options
    ? await entry.sock.sendMessage(jid, { text: content }, options)
    : await entry.sock.sendMessage(jid, { text: content });
  return { whatsappMessageId: sent.key.id };
}

/**
 * O cartão nativo de Pix do WhatsApp comum: uma `interactiveMessage` com um
 * botão `payment_info`, que o cliente vê com "Copiar código Pix".
 *
 * Aqui a "chave" declarada no `pix_static_code` é o próprio código copia e cola
 * — não a chave Pix cadastrada da empresa. Por isso o Baileys não precisa de
 * recebedor cadastrado para mandar o cartão, e o tipo é sempre EVP: é o mesmo
 * formato que o Chat Mix usa. O cadastro, quando existe, só melhora o nome
 * mostrado.
 *
 * O conteúdo é o `interactiveMessage` cru. O que faz o cartão renderizar no
 * celular NÃO está aqui, e sim em sendPixCardMessage: o envelope
 * `documentWithCaptionMessage` (compatibilidade multi-device) e os nós
 * binários `biz`/`bot` na retransmissão. Sem eles o servidor aceita e o
 * celular descarta em silêncio — foi exatamente o que aconteceu no primeiro
 * teste real (2026-09-13): a mensagem aparecia no chat e nunca chegava.
 */
function buildPixNativeFlowContent(card, channel, empresa) {
  const centavos = Math.round(Number(card.value) * 100);
  const referenceId = String(card.faturaId || `PIX${Date.now()}`);
  const titulo = `Fatura · vence ${formatarData(card.dueDate)}`;
  const valor = { value: centavos, offset: 100 };
  return {
    interactiveMessage: {
      // O que o celular mostra como texto do cartão (3º teste real): título em
      // negrito, corpo e rodapé. O valor em total_amount do botão NÃO aparece
      // sozinho — sem estas três partes o cartão vinha só com a chave e o botão.
      header: { title: titulo, hasMediaAttachment: false },
      body: { text: formatarValor(card.value) },
      footer: { text: 'Pix para pagamento' },
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          {
            name: 'payment_info',
            buttonParamsJson: JSON.stringify({
              currency: 'BRL',
              total_amount: { ...valor },
              reference_id: referenceId,
              type: 'physical-goods',
              order: {
                status: 'pending',
                subtotal: { ...valor },
                order_type: 'ORDER',
                items: [{ name: titulo, amount: { ...valor }, quantity: 1, sale_amount: { ...valor } }],
              },
              payment_settings: [
                {
                  type: 'pix_static_code',
                  pix_static_code: {
                    // O nome do canal ("automação", "principal"…) não é nome de
                    // recebedor: no 2º teste real ele apareceu no cabeçalho do
                    // cartão. Por isso a ordem: recebedor PIX cadastrado, nome
                    // da empresa configurado e, só em último caso, o canal.
                    merchant_name: (card.merchant && card.merchant.name) || empresa || (channel && channel.name) || '',
                    key: card.pixCode,
                    key_type: 'EVP',
                  },
                },
              ],
              share_payment_status: false,
              is_soft_deleted: false,
              referral: 'chat_attachment',
            }),
          },
        ],
      },
    },
  };
}

// Nó binário que o cliente oficial emite junto de uma mensagem interativa de
// pagamento, e sem o qual o celular do destinatário descarta o cartão sem
// erro nenhum (o Baileys de fábrica não o adiciona — só os forks).
//
// Sem o nó `bot` (biz_bot=1) de propósito: no 2º teste real (2026-09-13) ele
// fez o WhatsApp marcar o cartão como mensagem de robô — selo "IA", aviso
// "A IA da Meta recebe as mensagens" e polegares de avaliação — e esconder o
// título e o valor da fatura. Se sem ele o cartão deixar de chegar, é esta
// lista que volta a ter `{ tag: 'bot', attrs: { biz_bot: '1' } }`.
const PIX_CARD_ADDITIONAL_NODES = [
  { tag: 'biz', attrs: { native_flow_name: 'payment_info' } },
];

async function sendPixCardMessage(channel, toPhoneNumber, card) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const { generateWAMessageFromContent } = loadBaileysLib();
  const jid = `${toPhoneNumber}@s.whatsapp.net`;
  // O builder é puro: quem lê a configuração é esta função.
  const empresa = await getCompanyConfig();
  const content = buildPixNativeFlowContent(card, channel, empresa.name);
  const msg = generateWAMessageFromContent(jid, content, { userJid: entry.sock.user && entry.sock.user.id });
  // Envelope multi-device: é assim que o WhatsApp Web empacota botões e
  // mensagens interativas para os outros aparelhos da conta aceitarem.
  const patched = { documentWithCaptionMessage: { message: msg.message } };
  await entry.sock.relayMessage(jid, patched, { messageId: msg.key.id, additionalNodes: PIX_CARD_ADDITIONAL_NODES });
  return { whatsappMessageId: msg.key.id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, isVoiceNote, ...replyContext }) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));
  const jid = `${toPhoneNumber}@s.whatsapp.net`;
  // WhatsApp accepts media it will never deliver, so the mimetype we claim and the bytes
  // we actually send are worth one line in the log: without it, a media message that the
  // recipient can never open is indistinguishable from a successful send.
  console.log(
    `Sending ${messageType} to ${jid}: mimetype=${mediaMimeType} bytes=${buffer.length} ` +
      `header=${JSON.stringify(buffer.subarray(0, 4).toString('latin1'))}`
  );

  let payload;
  if (messageType === 'image') {
    payload = caption ? { image: buffer, caption } : { image: buffer };
  } else if (messageType === 'video') {
    payload = caption ? { video: buffer, caption } : { video: buffer };
  } else if (messageType === 'audio') {
    // A recording from the microphone button is a voice note, and saying so matters beyond
    // how the bubble looks: WhatsApp fetches a voice note when it arrives, while a plain
    // audio attachment waits on the recipient's auto-download settings. A download that is
    // deferred and then fails cannot be recovered - the protocol asks the sender to
    // re-upload, and Baileys has no code to answer that - so the message stays broken.
    payload = isVoiceNote
      ? { audio: buffer, mimetype: mediaMimeType, ptt: true }
      : { audio: buffer, mimetype: mediaMimeType };
  } else if (messageType === 'document') {
    payload = caption
      ? { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo', caption }
      : { document: buffer, mimetype: mediaMimeType, fileName: mediaFilename || 'arquivo' };
  } else if (messageType === 'sticker') {
    payload = { sticker: buffer };
  } else {
    throw new Error(`Unsupported media message type: ${messageType}`);
  }

  const options = buildQuotedOptions(jid, replyContext);
  const sent = options ? await entry.sock.sendMessage(jid, payload, options) : await entry.sock.sendMessage(jid, payload);
  return { whatsappMessageId: sent.key.id };
}

const MEDIA_VERIFY_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// WhatsApp will happily accept an upload and mark the message delivered even when the
// recipient can later fail to download it - the app just shows a broken audio bubble with
// no signal back to us. The only reliable way to know is to do what the recipient's phone
// does: download the file back from WhatsApp's own servers, letting Baileys reuploadRequest
// (=sock.updateMediaMessage) refresh an expired link along the way, same as the official app.
async function verifyMediaDelivery(channel, whatsappMessageId, toPhoneNumber, { timeoutMs = MEDIA_VERIFY_TIMEOUT_MS } = {}) {
  const entry = connections.get(channel.id);
  if (!entry) {
    return { verified: null, reason: 'no-connection' };
  }
  const jid = `${toPhoneNumber}@s.whatsapp.net`;
  const cached = entry.sock.messageRetryManager && entry.sock.messageRetryManager.getRecentMessage(jid, whatsappMessageId);
  if (!cached) {
    return { verified: null, reason: 'not-cached' };
  }
  const { downloadMediaMessage } = loadBaileysLib();
  const sentMessage = { key: { remoteJid: jid, id: whatsappMessageId, fromMe: true }, message: cached.message };
  try {
    await withTimeout(
      downloadMediaMessage(sentMessage, 'buffer', {}, { logger: noopLogger, reuploadRequest: entry.sock.updateMediaMessage }),
      timeoutMs,
      'timed out'
    );
    return { verified: true };
  } catch (err) {
    return { verified: false, reason: err.message };
  }
}

function getQrForChannel(channelId) {
  const entry = connections.get(channelId);
  return entry ? entry.qr : null;
}

// Brazilian mobiles gained a ninth digit, but plenty of WhatsApp accounts are still
// registered under the old 8-digit form (or vice versa). Given the digits the attendant
// typed, return the candidate forms to ask WhatsApp about, typed form first.
// [6-9] is safe here: Brazilian landlines start with 2-5, so an 8-digit landline never
// matches the "add a 9" branch and is left untouched.
function brazilianNumberVariants(digits) {
  const withNine = digits.match(/^55(\d{2})9(\d{8})$/);
  if (withNine) {
    const [, ddd, rest8] = withNine;
    return [digits, `55${ddd}${rest8}`];
  }
  const withoutNine = digits.match(/^55(\d{2})([6-9]\d{7})$/);
  if (withoutNine) {
    const [, ddd, rest8] = withoutNine;
    return [digits, `55${ddd}9${rest8}`];
  }
  return [digits];
}

async function resolveWhatsAppJid(channel, phoneNumber) {
  const entry = connections.get(channel.id);
  if (!entry) {
    throw new Error(`No active Baileys connection for channel ${channel.id}`);
  }
  const variants = brazilianNumberVariants(phoneNumber);
  const results = await entry.sock.onWhatsApp(...variants);
  const found = (results || []).filter((r) => r && r.exists !== false);
  if (found.length === 0) {
    return null;
  }
  const typedMatch = found.find((r) => jidToPhoneNumber(r.jid) === phoneNumber);
  return jidToPhoneNumber((typedMatch || found[0]).jid);
}

// O Baileys entrega a hora em messageTimestamp, que o protobuf pode devolver
// como number, como texto ou como Long ({ low, high }). Sem isso o historico
// usa a hora em que NOS gravamos — e quando a sessao reconecta e recebe um lote
// atrasado, todas as mensagens ficam com a mesma hora, fora de ordem.
// Qualquer coisa ilegivel vira null: melhor a hora da gravacao do que uma data
// inventada.
function sentAtFromBaileys(messageTimestamp) {
  if (messageTimestamp === undefined || messageTimestamp === null) return null;
  const raw =
    typeof messageTimestamp === 'object' && messageTimestamp !== null && 'low' in messageTimestamp
      ? messageTimestamp.low
      : messageTimestamp;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

module.exports = {
  startAllBaileysConnections,
  startBaileysConnection,
  stopBaileysChannel,
  reconnectBaileysChannel,
  addBaileysChannel,
  sendTextMessage,
  sendMediaMessage,
  sendPixCardMessage,
  buildPixNativeFlowContent,
  verifyMediaDelivery,
  resolveWhatsAppJid,
  brazilianNumberVariants,
  getQrForChannel,
  fetchContactAvatarForChannel,
  parseBaileysStatusUpdates,
  sentAtFromBaileys,
  extractQuotedMessageId,
  AVATAR_REFRESH_INTERVAL_MS,
};
