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
const { enviarPix, enviarPixQr, enviarBoleto } = require('../payments/payment-sender');

const router = express.Router();

// Mesmo limite/regra para pixCode e barCode: string não vazia, sem quebra de
// linha (o código tem que ir sozinho, numa mensagem, e uma quebra de linha no
// meio quebraria o "copia e cola" do cliente) e com um teto generoso (600
// chars) só para barrar lixo grosseiro — a atendente já pode mandar qualquer
// texto pela rota normal de mensagens, então aceitar isso aqui não abre
// acesso novo.
function validarCodigo(codigo) {
  return typeof codigo === 'string' && codigo.trim().length > 0 && codigo.length <= 600 && !codigo.includes('\n');
}

function validarValor(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number(value));
  return false;
}

function validarVencimento(dueDate) {
  return typeof dueDate === 'string' && dueDate.trim().length > 0;
}

// Carrega a conversa e confere posse (mesmas validações da boleto-pdf).
// Devolve a conversa em caso de sucesso, ou já responde e devolve null.
async function carregarConversaDoAgente(req, res, conversationId) {
  const conversation = await getConversationWithContact(conversationId);
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return null;
  }
  if (conversation.assignedAgentId !== req.agent.agentId) {
    res.status(403).json({ error: 'Only the assigned agent can send messages on this conversation' });
    return null;
  }
  return conversation;
}

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

/**
 * O id da fatura no SGP, só para o cartão de Pix usá-lo como reference_id. É
 * opcional de propósito: vindo estranho, viramos null em vez de recusar o
 * envio — o cliente não pode ficar sem o Pix por causa de um identificador
 * que serve apenas de referência.
 */
function normalizarFaturaId(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

router.post('/contratos/:contratoId/pix', requireAuth, async (req, res) => {
  const { conversationId, pixCode, value, dueDate, faturaId } = req.body || {};
  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  if (!validarCodigo(pixCode)) {
    return res.status(400).json({ error: 'pixCode is invalid' });
  }
  if (!validarValor(value)) {
    return res.status(400).json({ error: 'value is invalid' });
  }
  if (!validarVencimento(dueDate)) {
    return res.status(400).json({ error: 'dueDate is required' });
  }
  const conversation = await carregarConversaDoAgente(req, res, conversationId);
  if (!conversation) return;
  const messages = await enviarPix({
    conversationId: conversation.id,
    channelId: conversation.channelId,
    fatura: { value, dueDate, pixCode, id: normalizarFaturaId(faturaId) },
    sentBy: undefined,
  });
  res.status(201).json(messages);
});

router.post('/contratos/:contratoId/pix-qr', requireAuth, async (req, res) => {
  const { conversationId, pixCode, value, dueDate } = req.body || {};
  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  if (!validarCodigo(pixCode)) {
    return res.status(400).json({ error: 'pixCode is invalid' });
  }
  if (!validarValor(value)) {
    return res.status(400).json({ error: 'value is invalid' });
  }
  if (!validarVencimento(dueDate)) {
    return res.status(400).json({ error: 'dueDate is required' });
  }
  const conversation = await carregarConversaDoAgente(req, res, conversationId);
  if (!conversation) return;
  const messages = await enviarPixQr({
    conversationId: conversation.id,
    channelId: conversation.channelId,
    fatura: { value, dueDate, pixCode },
    sentBy: undefined,
  });
  res.status(201).json(messages);
});

router.post('/contratos/:contratoId/barcode', requireAuth, async (req, res) => {
  const { conversationId, barCode, value, dueDate } = req.body || {};
  if (!conversationId || typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  if (!validarCodigo(barCode)) {
    return res.status(400).json({ error: 'barCode is invalid' });
  }
  if (!validarValor(value)) {
    return res.status(400).json({ error: 'value is invalid' });
  }
  if (!validarVencimento(dueDate)) {
    return res.status(400).json({ error: 'dueDate is required' });
  }
  const conversation = await carregarConversaDoAgente(req, res, conversationId);
  if (!conversation) return;
  const messages = await enviarBoleto({
    conversationId: conversation.id,
    channelId: conversation.channelId,
    fatura: { value, dueDate, barCode },
    sentBy: undefined,
  });
  res.status(201).json(messages);
});

module.exports = router;
