const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getMediaFilePath } = require('../media/media-storage');
const {
  parseInboundMessages,
  parseStatusUpdates,
  parseTemplateStatusUpdates,
} = require('./meta-cloud.adapter');

const BASE_URL = 'https://waba-v2.360dialog.io';

function authHeaders(channel) {
  return { 'D360-API-KEY': channel.config.apiKey };
}

async function sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId } = {}) {
  const body = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: 'text',
    text: { body: content },
  };
  if (repliedToWhatsappMessageId) {
    body.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(`${BASE_URL}/messages`, body, { headers: authHeaders(channel) });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, repliedToWhatsappMessageId }) {
  const buffer = await fs.promises.readFile(getMediaFilePath(mediaPath));

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: mediaFilename || 'file', contentType: mediaMimeType });
  const uploadResponse = await axios.post(`${BASE_URL}/media`, form, {
    headers: { ...form.getHeaders(), ...authHeaders(channel) },
  });

  const mediaId = uploadResponse.data.id;
  const messagePayload = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: messageType,
    [messageType]: caption ? { id: mediaId, caption } : { id: mediaId },
  };
  if (repliedToWhatsappMessageId) {
    messagePayload.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(`${BASE_URL}/messages`, messagePayload, { headers: authHeaders(channel) });
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables, headerType, headerLink }) {
  const components = [];
  if (headerType && headerLink) {
    components.push({ type: 'header', parameters: [{ type: headerType, [headerType]: { link: headerLink } }] });
  }
  if (variables.length > 0) {
    components.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) });
  }
  const response = await axios.post(
    `${BASE_URL}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: authHeaders(channel) }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

async function downloadMedia(mediaId, channel) {
  const metaResponse = await axios.get(`${BASE_URL}/${mediaId}`, { headers: authHeaders(channel) });
  const fileResponse = await axios.get(metaResponse.data.url, {
    headers: authHeaders(channel),
    responseType: 'arraybuffer',
  });
  return Buffer.from(fileResponse.data);
}

async function createMetaTemplate(channel, { name, category, language, bodyText }) {
  const response = await axios.post(
    `${BASE_URL}/message_templates`,
    { name, category, language, components: [{ type: 'BODY', text: bodyText }] },
    { headers: authHeaders(channel) }
  );
  return { metaTemplateId: response.data.id, status: response.data.status };
}

async function listMetaTemplates(channel) {
  const response = await axios.get(`${BASE_URL}/message_templates`, { headers: authHeaders(channel) });
  return response.data.data || response.data;
}

async function deleteMetaTemplate(channel, { name, metaTemplateId }) {
  await axios.delete(`${BASE_URL}/message_templates`, {
    headers: authHeaders(channel),
    params: { name, hsm_id: metaTemplateId },
  });
}

async function registerWebhook(channel, webhookUrl) {
  await axios.post(`${BASE_URL}/v1/configs/webhook`, { url: webhookUrl }, { headers: authHeaders(channel) });
}

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  downloadMedia,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  registerWebhook,
  parseInboundMessages,
  parseStatusUpdates,
  parseTemplateStatusUpdates,
};
