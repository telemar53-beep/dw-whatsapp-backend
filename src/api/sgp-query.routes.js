const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  downloadBoletoPdf,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('../integrations/sgp-client');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');

const router = express.Router();

function handleSgpError(err, res) {
  if (err instanceof SgpNotConfiguredError) return res.status(400).json({ error: 'SGP integration is not configured' });
  if (err instanceof SgpDisabledError) return res.status(400).json({ error: 'SGP integration is not enabled' });
  if (err instanceof SgpClientNotFoundError) return res.status(404).json({ error: 'Client not found' });
  if (err instanceof SgpRequestError) return res.status(502).json({ error: 'Failed to reach SGP' });
  throw err;
}

router.get('/clientes', requireAuth, async (req, res) => {
  const cpf = typeof req.query.cpf === 'string' ? req.query.cpf.replace(/\D/g, '') : '';
  if (!cpf) {
    return res.status(400).json({ error: 'cpf is required' });
  }
  try {
    const result = await lookupClientByCpf(cpf);
    res.json(result);
  } catch (err) {
    handleSgpError(err, res);
  }
});

router.post('/contratos/:contratoId/boleto', requireAuth, async (req, res) => {
  try {
    const result = await getDuplicateInvoice(req.params.contratoId);
    res.json(result);
  } catch (err) {
    handleSgpError(err, res);
  }
});

router.post('/contratos/:contratoId/boleto-pdf', requireAuth, async (req, res) => {
  const { conversationId, boletoLink } = req.body || {};
  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  if (!boletoLink || typeof boletoLink !== 'string') {
    return res.status(400).json({ error: 'boletoLink is required' });
  }
  const conversation = await getConversationWithContact(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (conversation.assignedAgentId !== req.agent.agentId) {
    return res.status(403).json({ error: 'Only the assigned agent can send messages on this conversation' });
  }
  try {
    const buffer = await downloadBoletoPdf(boletoLink);
    const mediaPath = await saveMediaFile(buffer, '.pdf');
    const message = await enqueueOutboundMessage({
      conversationId: conversation.id,
      channelId: conversation.channelId,
      content: null,
      messageType: 'document',
      mediaPath,
      mediaMimeType: 'application/pdf',
      mediaFilename: 'boleto.pdf',
    });
    res.status(201).json(message);
  } catch (err) {
    handleSgpError(err, res);
  }
});

module.exports = router;
