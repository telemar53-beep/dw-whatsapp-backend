const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { getTriageConfig, listTriageOptions } = require('./triage.repository');
const { completeTriage, incrementTriageAttempts } = require('../conversations/conversation.repository');
const { findMatchingOption } = require('./triage-matcher');

function composeQuestionMessage(config, options) {
  const optionLines = options.map((option) => `${option.optionNumber} - ${option.sectorName}`).join('\n');
  return optionLines ? `${config.questionText}\n${optionLines}` : config.questionText;
}

async function shouldStartTriage(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.triageEnabled) return false;
  const options = await listTriageOptions();
  return options.length > 0;
}

async function sendTriageQuestion(conversationId, channelId) {
  const config = await getTriageConfig();
  const options = await listTriageOptions();
  await enqueueOutboundMessage({ conversationId, channelId, content: composeQuestionMessage(config, options) });
}

async function processTriageReply(conversation, channelId, replyText) {
  const options = await listTriageOptions();
  const matched = findMatchingOption(options, replyText);
  const config = await getTriageConfig();

  if (matched) {
    const updated = await completeTriage(conversation.id, matched.sectorId);
    if (!updated) return conversation;
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: config.confirmationText });
    return updated;
  }

  const attempts = await incrementTriageAttempts(conversation.id);
  if (attempts === 0) return conversation;
  if (attempts >= config.maxAttempts) {
    const updated = await completeTriage(conversation.id, null);
    if (!updated) return conversation;
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: config.confirmationText });
    return updated;
  }

  await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: composeQuestionMessage(config, options) });
  return { ...conversation, triageAttempts: attempts };
}

module.exports = { shouldStartTriage, sendTriageQuestion, processTriageReply };
