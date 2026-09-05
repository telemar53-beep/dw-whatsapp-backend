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

async function enqueueOutboundMessage({ conversationId, channelId, content }) {
  const message = await createMessage({
    conversationId,
    direction: 'outbound',
    content,
    whatsappMessageId: null,
    status: 'sent',
  });
  await getOutboundQueue().add(
    { messageId: message.id, conversationId, channelId, content },
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
