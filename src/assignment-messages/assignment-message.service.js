const { getAssignmentMessageConfig, claimProtocolNumber, clearProtocolNumber } = require('./assignment-message.repository');
const { substituteAssignmentPlaceholders } = require('./message-placeholders');
const { findAgentById } = require('../agents/agent.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');

async function sendOpeningMessageIfApplicable(conversation, agentId) {
  const config = await getAssignmentMessageConfig();
  if (!config.enabled) return;
  if (!config.agentIds.includes(agentId)) return;
  if (!config.channelIds.includes(conversation.channelId)) return;

  const protocolNumber = await claimProtocolNumber(conversation.id);
  try {
    const agent = await findAgentById(agentId);
    const content = substituteAssignmentPlaceholders(config.openingMessage, {
      agentName: agent.name,
      protocolNumber,
    });
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content });
  } catch (err) {
    await clearProtocolNumber(conversation.id);
    throw err;
  }
}

async function sendClosingMessageIfApplicable(conversation, agentId) {
  if (!conversation.protocolNumber) return;

  const config = await getAssignmentMessageConfig();
  const agent = await findAgentById(agentId);
  const content = substituteAssignmentPlaceholders(config.closingMessage, {
    agentName: agent.name,
    protocolNumber: conversation.protocolNumber,
  });
  await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content });
}

module.exports = { sendOpeningMessageIfApplicable, sendClosingMessageIfApplicable };
