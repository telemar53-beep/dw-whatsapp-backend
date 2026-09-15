const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getMediaFilePath } = require('../media/media-storage');
const { formatarData } = require('../payments/payment-card');

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

async function sendTextMessage(channel, toPhoneNumber, content, { repliedToWhatsappMessageId } = {}) {
  const { phoneNumberId, accessToken } = channel.config;
  const body = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    type: 'text',
    text: { body: content },
  };
  if (repliedToWhatsappMessageId) {
    body.context = { message_id: repliedToWhatsappMessageId };
  }
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    body,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

async function sendMediaMessage(channel, toPhoneNumber, { messageType, mediaPath, mediaMimeType, mediaFilename, caption, repliedToWhatsappMessageId }) {
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
  if (repliedToWhatsappMessageId) {
    messagePayload.context = { message_id: repliedToWhatsappMessageId };
  }
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
    params: { fields: 'id,name,language,category,status,rejected_reason,components' },
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

async function sendTemplateMessage(channel, toPhoneNumber, { name, language, variables, headerType, headerLink }) {
  const { phoneNumberId, accessToken } = channel.config;
  const components = [];
  if (headerType && headerLink) {
    components.push({ type: 'header', parameters: [{ type: headerType, [headerType]: { link: headerLink } }] });
  }
  if (variables.length > 0) {
    components.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) });
  }
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to: toPhoneNumber, type: 'template', template: { name, language: { code: language }, components } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

const MESSAGE_STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed']);

function parseStatusUpdates(webhookBody) {
  const updates = [];
  const entries = webhookBody.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        if (!MESSAGE_STATUS_VALUES.has(status.status)) continue;
        updates.push({ whatsappMessageId: status.id, status: status.status });
      }
    }
  }
  return updates;
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

/**
 * O cartão nativo de Pix dos canais oficiais: uma mensagem interativa
 * `order_details` com um `pix_dynamic_code`, que o WhatsApp mostra com o botão
 * "Copiar código Pix". Puro de propósito — o 360dialog manda exatamente o mesmo
 * corpo, só muda o endpoint e o cabeçalho de autenticação.
 *
 * A Meta cobra os valores em centavos inteiros (`offset: 100`), por isso o
 * Math.round: 89.9 tem de virar 8990, e um truncamento perderia um centavo.
 * O recebedor é obrigatório aqui (diferente do Baileys, onde a "chave" é o
 * próprio copia e cola): sem ele a Meta recusa a mensagem, então falhamos
 * antes da chamada e quem envia cai no texto.
 */
function buildPixOrderDetailsBody(to, card) {
  if (!card.merchant) throw new Error('Pix merchant is not configured');
  const centavos = Math.round(Number(card.value) * 100);
  const referenceId = String(card.faturaId || `PIX${Date.now()}`);
  // Hífen simples, e não o ponto do meio do cartão do Baileys: aqui o texto
  // passa pela validação da Meta, e o ASCII puro é o que não dá margem a recusa.
  const titulo = `Fatura - vence ${formatarData(card.dueDate)}`;
  const valor = { value: centavos, offset: 100 };
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'order_details',
      body: { text: `Pix da fatura - vence ${formatarData(card.dueDate)}` },
      action: {
        name: 'review_and_pay',
        parameters: {
          reference_id: referenceId,
          type: 'digital-goods',
          payment_type: 'br',
          payment_settings: [
            {
              type: 'pix_dynamic_code',
              pix_dynamic_code: {
                code: card.pixCode,
                merchant_name: card.merchant.name,
                key: card.merchant.key,
                key_type: card.merchant.keyType,
              },
            },
          ],
          currency: 'BRL',
          total_amount: { ...valor },
          order: {
            status: 'pending',
            items: [{ retailer_id: referenceId, name: titulo, amount: { ...valor }, quantity: 1 }],
            subtotal: { ...valor },
            // 1º teste real no canal oficial (2026-09-14): o cartão caiu para
            // texto. A documentação da Meta e da 360dialog trazem tax em todo
            // exemplo e exigem total_amount = subtotal + tax; sem o campo o
            // corpo é recusado. Fatura de provedor não tem imposto destacado:
            // zero.
            tax: { value: 0, offset: 100 },
          },
        },
      },
    },
  };
}

async function sendPixCardMessage(channel, toPhoneNumber, card) {
  const { phoneNumberId, accessToken } = channel.config;
  const body = buildPixOrderDetailsBody(toPhoneNumber, card);
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    body,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { whatsappMessageId: response.data.messages[0].id };
}

module.exports = {
  verifyWebhookChallenge,
  verifySignature,
  parseInboundMessages,
  parseStatusUpdates,
  sendTextMessage,
  downloadMetaMedia,
  sendMediaMessage,
  createMetaTemplate,
  listMetaTemplates,
  deleteMetaTemplate,
  sendTemplateMessage,
  parseTemplateStatusUpdates,
  sendPixCardMessage,
  buildPixOrderDetailsBody,
};
