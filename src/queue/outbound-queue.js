const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getOutboundQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('outbound-messages', config.redisUrl);
  }
  return queue;
}

async function enqueueOutboundMessage({ conversationId, channelId, content }) {
  return getOutboundQueue().add({ conversationId, channelId, content });
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
