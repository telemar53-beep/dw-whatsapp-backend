const Queue = require('bull');
const { loadConfig } = require('../config/env');
const { createMessage } = require('../conversations/message.repository');

let queue;

function getOutboundQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('outbound-messages', config.redisUrl);
  }
  return queue;
}

async function enqueueOutboundMessage({ conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables, headerType, headerLink }) {
  const message = await createMessage({
    conversationId,
    direction: 'outbound',
    content: content || null,
    whatsappMessageId: null,
    status: 'sent',
    messageType: messageType || 'text',
    mediaPath,
    mediaMimeType,
    mediaFilename,
  });
  await getOutboundQueue().add(
    {
      messageId: message.id,
      conversationId,
      channelId,
      content: message.content,
      messageType: message.messageType,
      mediaPath: message.mediaPath,
      mediaMimeType: message.mediaMimeType,
      mediaFilename: message.mediaFilename,
      templateName: templateName || null,
      templateLanguage: templateLanguage || null,
      templateVariables: templateVariables || null,
      headerType: headerType || null,
      headerLink: headerLink || null,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
  return message;
}

function processOutboundQueue(handler) {
  getOutboundQueue().process(async (job) => handler(job.data));
}

async function closeOutboundQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { getOutboundQueue, enqueueOutboundMessage, processOutboundQueue, closeOutboundQueue };
