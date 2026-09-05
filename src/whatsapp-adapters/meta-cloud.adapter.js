const crypto = require('crypto');
const axios = require('axios');

function verifyWebhookChallenge(query, verifyToken) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'];
  }
  return null;
}

function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const providedSignature = signatureHeader.slice('sha256='.length);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(providedSignature, 'hex');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function parseInboundMessages(webhookBody) {
  const messages = [];
  const entries = webhookBody.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata && value.metadata.phone_number_id;
      const contactsById = {};
      for (const contact of value.contacts || []) {
        contactsById[contact.wa_id] = contact.profile && contact.profile.name;
      }
      for (const message of value.messages || []) {
        if (message.type !== 'text') {
          continue;
        }
        messages.push({
          metaPhoneNumberId: phoneNumberId,
          fromPhoneNumber: message.from,
          contactDisplayName: contactsById[message.from] || null,
          whatsappMessageId: message.id,
          content: message.text.body,
        });
      }
    }
  }
  return messages;
}

async function sendTextMessage(channel, toPhoneNumber, content) {
  const { phoneNumberId, accessToken } = channel.config;
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: toPhoneNumber,
      type: 'text',
      text: { body: content },
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

module.exports = { verifyWebhookChallenge, verifySignature, parseInboundMessages, sendTextMessage };
