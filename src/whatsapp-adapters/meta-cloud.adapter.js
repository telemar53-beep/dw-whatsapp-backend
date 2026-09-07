const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getMediaFilePath } = require('../media/media-storage');

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

const MEDIA_MESSAGE_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];

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
        const base = {
          metaPhoneNumberId: phoneNumberId,
          fromPhoneNumber: message.from,
          contactDisplayName: contactsById[message.from] || null,
          whatsappMessageId: message.id,
        };
        if (message.type === 'text') {
          messages.push({ ...base, messageType: 'text', content: message.text.body });
        } else if (MEDIA_MESSAGE_TYPES.includes(message.type)) {
          const media = message[message.type];
          if (media) {
            messages.push({
              ...base,
              messageType: message.type,
              mediaId: media.id,
              mediaMimeType: media.mime_type,
              mediaFilename: media.filename || null,
              content: media.caption || null,
            });
          }
        } else if (message.type === 'location') {
          if (message.location) {
            messages.push({
              ...base,
              messageType: 'location',
              latitude: message.location.latitude,
              longitude: message.location.longitude,
            });
          }
        }
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

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption }) {
  const { phoneNumberId, accessToken } = channel.config;
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: mediaFilename || 'file', contentType: mediaMimeType });
  const uploadResponse = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/media`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
  });

  const mediaId = uploadResponse.data.id;
  const messagePayload = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: messageType,
    [messageType]: caption ? { id: mediaId, caption } : { id: mediaId },
  };
  const response = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, messagePayload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function downloadMetaMedia(mediaId, accessToken) {
  const metaResponse = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const fileResponse = await axios.get(metaResponse.data.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(fileResponse.data);
}

async function createMetaTemplate(channel, { name, category, language, bodyText }) {
  const { accessToken, wabaId } = channel.config;
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${wabaId}/message_templates`,
    { name, category, language, components: [{ type: 'BODY', text: bodyText }] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { metaTemplateId: response.data.id, status: response.data.status };
}

async function listMetaTemplates(channel) {
  const { accessToken, wabaId } = channel.config;
  const response = await axios.get(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { fields: 'id,name,language,category,status,rejected_reason' },
  });
  return response.data.data;
}

async function deleteMetaTemplate(channel, { name, metaTemplateId }) {
  const { accessToken, wabaId } = channel.config;
  await axios.delete(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { name, hsm_id: metaTemplateId },
  });
}

async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables }) {
  const { phoneNumberId, accessToken } = channel.config;
  const components = variables.length > 0 ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }] : [];
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

function parseTemplateStatusUpdates(webhookBody) {
  const updates = [];
  const entries = webhookBody.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'message_template_status_update') continue;
      const value = change.value || {};
      if (!value.message_template_id) continue;
      updates.push({
        metaTemplateId: String(value.message_template_id),
        event: value.event,
        reason: value.reason || null,
      });
    }
  }
  return updates;
}

module.exports = {
  verifyWebhookChallenge,
  verifySignature,
  parseInboundMessages,
  sendTextMessage,
  downloadMetaMedia,
  sendMediaMessage,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  sendTemplateMessage,
  parseTemplateStatusUpdates,
};
