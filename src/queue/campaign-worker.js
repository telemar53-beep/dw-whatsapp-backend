const { processCampaignQueue } = require('./campaign-queue');
const { processCampaignRecipient } = require('../campaigns/campaign-processor');

function startCampaignWorker() {
  processCampaignQueue(async (data) => {
    await processCampaignRecipient(data);
  });
}

module.exports = { startCampaignWorker };
