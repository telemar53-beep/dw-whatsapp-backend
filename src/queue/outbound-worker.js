const { processOutboundQueue, enqueueOutboundMessage } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, updateMessageStatus, recordMessageSent, markPixFallbackSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { emitToAgent } = require('../realtime/socket-server');
const { getPixMerchant } = require('../integrations/sgp-client');
const { cartaoPix } = require('../payments/payment-card');
const { mensagemSegura } = require('../ai/safe-error-log');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
  '360dialog': threeSixtyDialogAdapter,
};

const AUDIO_DELIVERY_CHECK_DELAY_MS = 5000;
const PIX_DELIVERY_CHECK_DELAY_MS = 60000;

// Baileys can mark an audio message delivered even when WhatsApp never lets the recipient
// download it - the customer just sees a broken bubble with no signal back to us (see
// verifyMediaDelivery). A few seconds after sending, check whether the file is actually
// retrievable, and if it isn't, resend it automatically so the attendant doesn't have to
// notice a stuck customer and fix it by hand.
async function checkAudioDelivery({ channel, whatsappMessageId, conversation, mediaPath, mediaMimeType, mediaFilename, isVoiceNote }) {
  const result = await baileysManager.verifyMediaDelivery(channel, whatsappMessageId, conversation.contactPhoneNumber);
  if (result.verified !== false) {
    console.log(`Audio delivery check for ${whatsappMessageId}: verified=${result.verified} reason=${result.reason || 'n/a'}`);
    return;
  }
  console.warn(`Audio ${whatsappMessageId} failed delivery verification (${result.reason}); resending automatically`);
  const resent = await enqueueOutboundMessage({
    conversationId: conversation.id,
    channelId: channel.id,
    messageType: 'audio',
    mediaPath,
    mediaMimeType,
    mediaFilename,
    isVoiceNote,
  });
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation, message: resent });
  }
}

function scheduleAudioDeliveryCheck(ctx) {
  setTimeout(() => {
    checkAudioDelivery(ctx).catch((err) => {
      console.error(`Audio delivery check crashed for ${ctx.whatsappMessageId}`, err);
    });
  }, AUDIO_DELIVERY_CHECK_DELAY_MS);
}

// O cartao nativo de Pix e uma mensagem interativa, e nem todo aparelho a
// reconhece: no teste de 2026-09-14 o cartao ficou com um tique so (o servidor
// aceitou) enquanto o texto seguinte chegou com dois. Como o relayMessage nao
// falha nesse caso, a unica pista que temos e a ausencia do recibo de entrega.
// Um minuto depois do envio, se a mensagem continua em 'sent', mandamos o de
// sempre - cartao de texto + codigo sozinho - para o cliente nao ficar sem o
// Pix por causa do aparelho dele.
async function checkPixDelivery({ messageId, conversation, channel, pixCode, metadata }) {
  const msg = await findMessageById(messageId);
  if (!msg || msg.status === 'delivered' || msg.status === 'read') {
    console.log(`Pix card ${msg ? msg.whatsappMessageId : messageId} delivered`);
    return;
  }
  // O caminho de falha do envio ja cuidou desta mensagem; nao duplicar.
  if (msg.status === 'failed') return;

  // A marca vive na metadata da mensagem, no banco: um restart do worker ou um
  // retry da fila nao pode mandar o codigo duas vezes.
  const marcou = await markPixFallbackSent(messageId);
  if (!marcou) return;

  console.warn(`Pix card ${messageId} got no delivery receipt after 60s; sending the text fallback`);
  const textos = [cartaoPix({ valor: (metadata || {}).value, vencimento: (metadata || {}).dueDate }), pixCode];
  for (const content of textos) {
    const enviada = await enqueueOutboundMessage({
      conversationId: conversation.id,
      channelId: channel.id,
      content,
      messageType: 'text',
      sentBy: msg.sentBy,
    });
    if (conversation.assignedAgentId) {
      emitToAgent(conversation.assignedAgentId, 'message:new', { conversation, message: enviada });
    }
  }
}

function schedulePixDeliveryCheck(ctx) {
  setTimeout(() => {
    checkPixDelivery(ctx).catch((err) => {
      // mensagemSegura: o codigo Pix nao entra em log nenhum, nem pelo erro.
      console.error(`Pix delivery check crashed for ${ctx.messageId}: ${mensagemSegura(err)}`);
    });
  }, PIX_DELIVERY_CHECK_DELAY_MS);
}

/**
 * Manda o Pix da melhor forma que o canal aceitar, sem nunca deixar o cliente
 * sem o código.
 *
 * A preferência é o cartão nativo do WhatsApp, com botão "Copiar código Pix".
 * Nos canais oficiais ele exige o recebedor cadastrado (nome, chave e tipo);
 * no Baileys não, porque lá a "chave" declarada é o próprio copia e cola.
 *
 * A decisão fica aqui, na hora do envio, e não em quem enfileirou: só agora se
 * sabe por qual canal a mensagem vai sair e se há recebedor cadastrado. E
 * quando o cartão falha — recebedor faltando, API recusando, adaptador que nem
 * sabe mandar cartão — a queda é para o formato de sempre (cartão de texto +
 * código sozinho), nunca para uma mensagem não entregue.
 *
 * O id gravado na mensagem é o do envio do código: é essa a bolha que o cliente
 * copia, e é por ela que os recibos de entrega/leitura devem ser casados.
 */
async function sendPixOrFallback({ adapter, channel, to, pixCode, metadata }) {
  const merchant = await getPixMerchant();
  const precisaMerchant = channel.type !== 'baileys';
  if (typeof adapter.sendPixCardMessage === 'function' && (!precisaMerchant || merchant)) {
    try {
      const { whatsappMessageId } = await adapter.sendPixCardMessage(channel, to, {
        pixCode,
        value: metadata.value,
        dueDate: metadata.dueDate,
        faturaId: metadata.faturaId,
        merchant,
      });
      return { whatsappMessageId, viaCartao: true };
    } catch (err) {
      // mensagemSegura, e nunca o erro cru nem o pixCode: o código Pix não entra
      // em log nenhum.
      console.error(`Pix card send failed on channel ${channel.id}, falling back to text: ${mensagemSegura(err)}`);
    }
  }
  await adapter.sendTextMessage(channel, to, cartaoPix({ valor: metadata.value, vencimento: metadata.dueDate }));
  const { whatsappMessageId } = await adapter.sendTextMessage(channel, to, pixCode);
  return { whatsappMessageId, viaCartao: false };
}

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, metadata, mediaPath, mediaMimeType, mediaFilename, isVoiceNote, templateName, templateLanguage, templateVariables, headerType, headerLink, repliedToMessageId }) => {
    const existingMessage = await findMessageById(messageId);
    if (existingMessage && existingMessage.whatsappMessageId) return;
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];

      let replyOptions;
      if (repliedToMessageId) {
        const original = await findMessageById(repliedToMessageId);
        if (original) {
          replyOptions = {
            repliedToWhatsappMessageId: original.whatsappMessageId,
            repliedToDirection: original.direction,
            repliedToContent: original.content,
          };
        }
      }

      const { whatsappMessageId, viaCartao } = templateName
        ? await adapter.sendTemplateMessage(channel, conversation.contactPhoneNumber, {
            name: templateName,
            language: templateLanguage,
            variables: templateVariables || [],
            headerType,
            headerLink,
          })
        : messageType === 'pix'
          ? await sendPixOrFallback({
              adapter,
              channel,
              to: conversation.contactPhoneNumber,
              pixCode: content,
              metadata: metadata || {},
            })
          : messageType && messageType !== 'text'
            ? await adapter.sendMediaMessage(channel, conversation.contactPhoneNumber, {
                messageType,
                mediaPath,
                mediaMimeType,
                mediaFilename,
                caption: content,
                ...(isVoiceNote ? { isVoiceNote: true } : {}),
                ...(replyOptions || {}),
              })
            : replyOptions
              ? await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content, replyOptions)
              : await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
      const message = await recordMessageSent(messageId, whatsappMessageId);
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
      }
      if (channel.type === 'baileys' && messageType === 'audio' && whatsappMessageId) {
        scheduleAudioDeliveryCheck({ channel, whatsappMessageId, conversation, mediaPath, mediaMimeType, mediaFilename, isVoiceNote });
      }
      // So faz sentido conferir o que saiu como cartao: o que ja caiu para texto
      // nao tem para onde cair.
      if (channel.type === 'baileys' && messageType === 'pix' && viaCartao) {
        schedulePixDeliveryCheck({ messageId, conversation, channel, pixCode: content, metadata });
      }
    } catch (err) {
      const message = await updateMessageStatus(messageId, 'failed');
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
      }
      throw err;
    }
  });
}

module.exports = { startOutboundWorker, sendPixOrFallback };
