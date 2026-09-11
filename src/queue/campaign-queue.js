const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getCampaignQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('campaign-messages', config.redisUrl, {
      limiter: { max: 20, duration: 60000 },
    });
  }
  return queue;
}

function enqueueCampaignRecipient(data) {
  return getCampaignQueue().add(data, { attempts: 1 });
}

function processCampaignQueue(handler) {
  getCampaignQueue().process(async (job) => handler(job.data));
}

async function closeCampaignQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { getCampaignQueue, enqueueCampaignRecipient, processCampaignQueue, closeCampaignQueue };
