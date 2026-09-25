const express = require('express');
const { verifySgpApiKey, findSgpDispatchByReferenceId, createSgpDispatch } = require('../integrations/sgp-integration.repository');
const { parseSgpTemplatePayload, SgpTemplatePayloadError, extrairCamposDoDisparo } = require('../integrations/sgp-template-payload-parser');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateByNameAndWaba } = require('../templates/template.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { resolverContatoDoDisparo } = require('../conversations/dispatch-contact');
const { metadataDoDisparoSgp } = require('../conversations/automatic-message');
const { substituteVariables } = require('../templates/template-validator');
const { findOpenConversation, createConversation, getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent } = require('../realtime/socket-server');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { sgpLimiter } = require('../config/rate-limiters');

const router = express.Router();
const UNIQUE_VIOLATION = '23505';

async function requireSgpApiKey(req, res, next) {
  const apiKey = typeof req.query.token === 'string' ? req.query.token : null;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const verification = await verifySgpApiKey(apiKey);
  if (verification.status === 'not_configured') {
    return res.status(400).json({ error: 'SGP integration is not configured' });
  }
  if (verification.status === 'disabled') {
    return res.status(400).json({ error: 'SGP integration is not enabled' });
  }
  if (verification.status === 'invalid') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.sgpIntegrationId = verification.integrationId;
  req.sgpChannelId = verification.channelId;
  req.sgpMode = verification.mode;
  next();
}

router.get('/messages', sgpLimiter, requireSgpApiKey, async (req, res) => {
  const { phoneNumber, content, referenceId } = req.query;
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const hasReferenceId = typeof referenceId === 'string' && referenceId.trim().length > 0;

  if (hasReferenceId) {
    const existingDispatch = await findSgpDispatchByReferenceId(referenceId);
    if (existingDispatch) {
      return res.status(200).json({
        conversationId: existingDispatch.conversationId,
        messageId: existingDispatch.messageId,
        duplicate: true,
      });
    }
  }

  const channel = await findChannelById(req.sgpChannelId);
  if (!channel) {
    return res.status(400).json({ error: 'The configured channel no longer exists' });
  }

  let canonicalPhoneNumber;
  let outboundPayload;

  if (req.sgpMode === 'template') {
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedPhoneNumber) {
      return res.status(400).json({ error: 'A valid phoneNumber is required' });
    }
    canonicalPhoneNumber = normalizedPhoneNumber;

    let payload;
    try {
      payload = parseSgpTemplatePayload(content);
    } catch (err) {
      if (err instanceof SgpTemplatePayloadError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const template = await findTemplateByNameAndWaba(payload.templateName, channel.config.wabaId);
    if (!template) {
      return res.status(400).json({ error: `Template "${payload.templateName}" not found for this channel` });
    }
    // Os outros tres caminhos que enviam template (/start, envio numa conversa e
    // campanha) conferem APPROVED antes de enfileirar; este nao conferia. Um
    // template pausado ou rejeitado passava daqui, virava linha em messages e so
    // morria na chamada ao provedor — erro de API no log, sem dizer a quem
    // configurou a regra no SGP o que estava errado. As duas causas ficam
    // separadas de proposito: "nao aprovado na Meta" e "marcado para atendimento"
    // se resolvem em lugares diferentes, e colapsa-las num "not found" custaria
    // uma tarde de procura pelo nome errado.
    if (template.status !== 'APPROVED') {
      return res.status(400).json({ error: `Template "${template.name}" is not approved by Meta (status: ${template.status})` });
    }
    if (template.purpose !== 'disparo') {
      return res.status(400).json({ error: `Template "${template.name}" is not marked for dispatch (purpose: ${template.purpose})` });
    }
    if (payload.variables.length !== template.variableCount) {
      return res.status(400).json({ error: `Template "${template.name}" requires exactly ${template.variableCount} variable(s)` });
    }
    if ((payload.headerType || null) !== (template.headerType || null)) {
      return res.status(400).json({ error: `Template "${template.name}" header type mismatch` });
    }

    // Fase 1B (25/09/2026): o registro da mensagem passa a guardar o que o cliente recebeu
    // (o corpo aprovado com as variáveis — a mesma montagem da campanha e do envio da
    // atendente) e a metadata de origem. O que vai para a Meta NÃO muda: o worker de saída
    // envia pelo template (nome, idioma, variáveis, cabeçalho) e ignora `content` quando há
    // templateName. Sem corpo cadastrado, o registro fica sem texto, como antes.
    outboundPayload = {
      content: template.bodyText ? substituteVariables(template.bodyText, payload.variables) : null,
      templateName: template.name,
      templateLanguage: template.language,
      templateVariables: payload.variables,
      headerType: payload.headerType,
      headerLink: payload.headerLink,
      metadata: metadataDoDisparoSgp({
        integrationId: req.sgpIntegrationId,
        modo: 'template',
        template,
        campos: extrairCamposDoDisparo(content),
        referenceId: hasReferenceId ? referenceId : undefined,
      }),
    };
  } else {
    if (channel.status !== 'connected') {
      return res.status(400).json({ error: 'The configured channel is not connected' });
    }
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedPhoneNumber) {
      return res.status(400).json({ error: 'A valid phoneNumber is required' });
    }
    canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
    if (!canonicalPhoneNumber) {
      return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
    }
    // Texto livre (Baileys): o conteúdo vai cru para o cliente, então nada é extraído dele.
    outboundPayload = {
      content,
      metadata: metadataDoDisparoSgp({
        integrationId: req.sgpIntegrationId,
        modo: 'freetext',
        referenceId: hasReferenceId ? referenceId : undefined,
      }),
    };
  }

  // Fase 1A (25/09/2026): no modo template (Meta) o número vem do SGP com o 9, e a resposta
  // do cliente chega com o wa_id, que no DDD 98 vem sem o 9. O resolvedor considera as duas
  // formas e o histórico próprio para o disparo cair no mesmo contato da resposta. No modo
  // freetext (Baileys) isso já acontece em resolveWhatsAppJid, que pergunta ao WhatsApp.
  const contact = req.sgpMode === 'template'
    ? await resolverContatoDoDisparo(canonicalPhoneNumber)
    : await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, null);

  let conversation = await findOpenConversation(contact.id, channel.id);
  if (!conversation) {
    try {
      conversation = await createConversation(contact.id, channel.id, null, 'silent');
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      conversation = await findOpenConversation(contact.id, channel.id);
    }
  }

  const message = await enqueueOutboundMessage({ conversationId: conversation.id, channelId: channel.id, ...outboundPayload });

  if (conversation.assignedAgentId) {
    const conversationWithContact = await getConversationWithContact(conversation.id);
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  }

  if (hasReferenceId) {
    try {
      await createSgpDispatch({ referenceId, conversationId: conversation.id, messageId: message.id });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
    }
  }

  res.status(200).json({ conversationId: conversation.id, messageId: message.id });
});

module.exports = router;
