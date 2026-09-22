const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateById } = require('../templates/template.repository');
const { substituteVariables } = require('../templates/template-validator');
const { isOfficialChannelType } = require('../channels/channel-types');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  countCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  listCampaignRecipientsPage,
  countCampaignRecipientsByStatus,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
  deleteCampaign,
} = require('../campaigns/campaign.repository');
const { enqueueCampaignRecipient } = require('../queue/campaign-queue');

const router = express.Router();
router.use(requireAuth);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.param('id', (req, res, next, id) => {
  if (!UUID_PATTERN.test(id)) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  next();
});

function parseRecipients(raw) {
  const lines = (raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  const parsed = [];
  for (const line of lines) {
    const [phonePart, ...nameParts] = line.split(',');
    const rawPhoneNumber = (phonePart || '').trim();
    const phoneNumber = rawPhoneNumber.replace(/\D/g, '');
    const displayName = nameParts.join(',').trim() || null;
    if (!phoneNumber) {
      parsed.push({ rawPhoneNumber, phoneNumber: '', displayName, status: 'failed', errorMessage: 'Número inválido' });
      continue;
    }
    if (seen.has(phoneNumber)) continue;
    seen.add(phoneNumber);
    parsed.push({ rawPhoneNumber, phoneNumber, displayName, status: 'pending' });
  }
  return parsed;
}

router.post('/', async (req, res) => {
  const { name, channelId, content, templateId, templateVariables, recipients } = req.body || {};
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }

  let channel;
  try {
    channel = await findChannelById(channelId);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    throw err;
  }
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys' && !isOfficialChannelType(channel.type)) {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }
  if (channel.type === 'baileys' && channel.status !== 'connected') {
    return res.status(400).json({ error: 'This channel is not connected' });
  }

  const parsedRecipients = parseRecipients(recipients);
  if (!parsedRecipients.some((r) => r.status === 'pending')) {
    return res.status(400).json({ error: 'No valid recipient found in the list' });
  }
  if (parsedRecipients.length > 2000) {
    return res.status(400).json({ error: 'A lista não pode ter mais de 2000 destinatários' });
  }

  let messageType;
  let finalContent;
  let templateName = null;
  let templateLanguage = null;
  let finalTemplateVariables = null;

  if (channel.type === 'baileys') {
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }
    messageType = 'text';
    finalContent = content;
  } else {
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    const template = await findTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (template.status !== 'APPROVED') {
      return res.status(400).json({ error: 'This template is not approved' });
    }
    if (template.wabaId !== channel.config.wabaId) {
      return res.status(400).json({ error: "This template does not belong to this channel's WABA" });
    }
    const variables = Array.isArray(templateVariables) ? templateVariables : [];
    if (variables.length !== template.variableCount) {
      return res.status(400).json({ error: `This template requires exactly ${template.variableCount} variable(s)` });
    }
    if (variables.some((v) => typeof v !== 'string' || !v.trim())) {
      return res.status(400).json({ error: 'Each template variable must be a non-empty string' });
    }
    messageType = 'template';
    finalContent = substituteVariables(template.bodyText, variables);
    templateName = template.name;
    templateLanguage = template.language;
    finalTemplateVariables = variables;
  }

  const campaign = await createCampaign({
    name,
    channelId: channel.id,
    messageType,
    content: finalContent,
    templateName,
    templateLanguage,
    templateVariables: finalTemplateVariables,
    createdBy: req.agent.agentId,
    totalRecipients: parsedRecipients.length,
  });

  let createdRecipients;
  try {
    createdRecipients = await createCampaignRecipients(campaign.id, parsedRecipients);
  } catch (err) {
    await deleteCampaign(campaign.id);
    throw err;
  }

  const preFailedCount = createdRecipients.filter((r) => r.status === 'failed').length;
  if (preFailedCount > 0) {
    await incrementCampaignCounter(campaign.id, 'failed', preFailedCount);
  }

  createdRecipients
    .filter((r) => r.status === 'pending')
    .forEach((r) => {
      enqueueCampaignRecipient({
        recipientId: r.id,
        campaignId: campaign.id,
        channelId: channel.id,
        phoneNumber: r.phoneNumber,
        displayName: r.displayName,
        content: finalContent,
        templateName,
        templateLanguage,
        templateVariables: finalTemplateVariables,
      }).catch(async (err) => {
        console.error(`Failed to enqueue campaign recipient ${r.id}`, err);
        try {
          await updateCampaignRecipientStatus(r.id, { status: 'failed', errorMessage: err.message });
          await incrementCampaignCounter(campaign.id, 'failed');
        } catch (recoveryErr) {
          console.error(`Failed to record enqueue failure for campaign recipient ${r.id}`, recoveryErr);
        }
      });
    });

  res.status(201).json(campaign);
});

const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

// Le um inteiro de query string sem "consertar" nada. Aqui um clamp seria
// perigoso: a presenca do parametro e o que decide o FORMATO da resposta, e um
// valor errado viraria um envelope que o cliente nao pediu.
function parseInteiro(raw, { min, max }) {
  if (!/^\d+$/.test(String(raw))) return null;
  const valor = Number(raw);
  if (valor < min || valor > max) return null;
  return valor;
}

router.get('/', async (req, res) => {
  const querPaginar = req.query.limit !== undefined || req.query.offset !== undefined;
  if (!querPaginar) {
    // Ninguem pediu pagina: array puro, do jeito que sempre foi.
    const campaigns = await listCampaigns();
    return res.json(campaigns);
  }

  const limit = req.query.limit === undefined
    ? LIST_DEFAULT_LIMIT
    : parseInteiro(req.query.limit, { min: 1, max: LIST_MAX_LIMIT });
  const offset = req.query.offset === undefined
    ? 0
    : parseInteiro(req.query.offset, { min: 0, max: Number.MAX_SAFE_INTEGER });
  if (limit === null || offset === null) {
    return res.status(400).json({ error: `limit must be an integer from 1 to ${LIST_MAX_LIMIT} and offset a non-negative integer` });
  }

  const [items, total] = await Promise.all([listCampaigns({ limit, offset }), countCampaigns()]);
  res.json({ items, total, hasMore: offset + items.length < total });
});

router.get('/:id', async (req, res) => {
  const campaign = await findCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const recipients = await listCampaignRecipients(campaign.id);
  res.json({ ...campaign, recipients });
});

const RECIPIENTS_DEFAULT_LIMIT = 200;
const RECIPIENTS_MAX_LIMIT = 500;

// Os mesmos quatro valores do CHECK de campaign_recipients.status. Ficam aqui
// porque sao validacao de entrada HTTP: o banco ja recusa o resto, e a rota
// so precisa transformar isso em 400 em vez de deixar virar erro de query.
const RECIPIENT_STATUSES = ['pending', 'sent', 'failed', 'skipped'];

// Aqui o clamp e seguro, ao contrario da listagem: a resposta e sempre
// envelopada, entao um limite ajustado nao troca o formato de nada.
function clamp(raw, { fallback, min, max }) {
  const valor = parseInt(raw, 10);
  if (!Number.isInteger(valor)) return fallback;
  return Math.min(Math.max(valor, min), max);
}

router.get('/:id/recipients', async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !RECIPIENT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${RECIPIENT_STATUSES.join(', ')}` });
  }

  const campaign = await findCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const limit = clamp(req.query.limit, { fallback: RECIPIENTS_DEFAULT_LIMIT, min: 1, max: RECIPIENTS_MAX_LIMIT });
  const offset = clamp(req.query.offset, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
  const [items, counts] = await Promise.all([
    listCampaignRecipientsPage(campaign.id, { limit, offset, status }),
    countCampaignRecipientsByStatus(campaign.id),
  ]);

  // O total sai das proprias contagens: com filtro e o valor daquele status,
  // sem filtro e a soma dos quatro. Derivar em vez de consultar de novo poupa
  // uma query e, mais importante, impede que total e counts se contradigam.
  const total = status === undefined
    ? Object.values(counts).reduce((soma, valor) => soma + valor, 0)
    : counts[status];

  res.json({ items, total, hasMore: offset + items.length < total, counts });
});

module.exports = router;
