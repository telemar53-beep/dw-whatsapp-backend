const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const { loadConfig } = require('../config/env');
const {
  listChannels,
  createChannel,
  findChannelById,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  updateChannelAiEnabled,
  updateChannelAiTriageEnabled,
  updateChannelAiNightModeEnabled,
  countChannelDependents,
  deleteChannel,
  convertChannelToMetaCloud,
  updateChannelName,
} = require('../channels/channel.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const { getChannelConnection } = require('../channels/channel-connection');
const { checkMetaCloudSetup } = require('../channels/meta-cloud-setup');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { isOfficialChannelType } = require('../channels/channel-types');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';

// Canal oficial (meta_cloud/360dialog) nao tem handshake para avisar que
// conectou: o vinculo e a propria credencial, conferida aqui na criacao. Como
// so o baileys.manager chama updateChannelStatus, um canal oficial que
// nascesse com o DEFAULT 'disconnected' ficaria "Desconectado" para sempre no
// cartao de Canais, na faixa do topo do chat e no envio pela integracao SGP.
function initialStatusFor(type) {
  return isOfficialChannelType(type) ? 'connected' : undefined;
}

function authenticateQrRoute(req, res, next) {
  const header = req.headers.authorization;
  const headerToken = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const token = headerToken || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    req.agent = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!hasIntegrationsAccess(req.agent)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

function toChannelResponse(channel, connection) {
  return {
    connection: connection || undefined,
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
    hidden: channel.hidden,
    welcomeMessage: channel.welcomeMessage,
    aiEnabled: channel.aiEnabled,
    aiTriageEnabled: channel.aiTriageEnabled,
    aiNightModeEnabled: channel.aiNightModeEnabled,
    wabaId: isOfficialChannelType(channel.type) ? channel.config.wabaId : undefined,
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const channels = await listChannels({ includeHidden: req.query.includeHidden === 'true' });
  // Em paralelo e com o erro engolido de proposito: a tela de Canais nao pode
  // deixar de carregar porque a Graph API esta fora do ar. Sem resposta, o
  // canal volta ao selo "Nao verificada" de antes.
  const connections = await Promise.all(channels.map((channel) => getChannelConnection(channel).catch(() => null)));
  res.json(channels.map((channel, index) => toChannelResponse(channel, connections[index])));
});

router.post('/', requireAuth, requireIntegrationsAccess, async (req, res) => {
  const { type, name, phoneNumber } = req.body || {};
  if (!type || !name || !phoneNumber) {
    return res.status(400).json({ error: 'type, name and phoneNumber are required' });
  }

  try {
    if (type === 'meta_cloud') {
      const { phoneNumberId, accessToken, wabaId } = req.body;
      if (!phoneNumberId || !accessToken || !wabaId) {
        return res.status(400).json({ error: 'phoneNumberId, accessToken and wabaId are required for meta_cloud channels' });
      }
      // Confere com a Meta antes de gravar, como o 360dialog logo abaixo ja
      // faz: sem isso o canal nasce "conectado" com qualquer dado e o erro so
      // aparece quando o cliente manda mensagem e nada chega.
      const check = await checkMetaCloudSetup({ phoneNumberId, accessToken, wabaId, phoneNumber });
      if (!check.ok) {
        return res.status(400).json({ error: check.error });
      }
      const channel = await createChannel({
        type,
        name,
        phoneNumber,
        config: { phoneNumberId, accessToken, wabaId },
        status: initialStatusFor(type),
      });
      return res.status(201).json(channel);
    }

    if (type === '360dialog') {
      const { apiKey, wabaId } = req.body;
      if (!apiKey || !wabaId) {
        return res.status(400).json({ error: 'apiKey and wabaId are required for 360dialog channels' });
      }
      const webhookToken = crypto.randomBytes(24).toString('hex');
      const config = { apiKey, wabaId, webhookToken };
      const channel = await createChannel({ type, name, phoneNumber, config, status: initialStatusFor(type) });
      const webhookUrl = `${loadConfig().publicBaseUrl}/webhooks/360dialog/${webhookToken}`;
      try {
        await threeSixtyDialogAdapter.registerWebhook(channel, webhookUrl);
      } catch (err) {
        console.error('Failed to register 360dialog webhook', err.response?.data || err.message || err);
        await deleteChannel(channel.id);
        return res.status(400).json({ error: 'Não foi possível registrar o webhook na 360dialog — confira a API Key' });
      }
      return res.status(201).json(channel);
    }

    if (type === 'baileys') {
      const channel = await baileysManager.addBaileysChannel({ name, phoneNumber });
      return res.status(201).json(channel);
    }
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'A channel with this phone number already exists' });
    }
    throw err;
  }

  return res.status(400).json({ error: 'type must be meta_cloud, baileys, or 360dialog' });
});

// Define as credenciais Meta Cloud deste canal, e serve a dois casos:
//
// - canal de outro provedor: converte no lugar, porque recriar nao e opcao (o
//   telefone e unico na tabela, e excluir canal com conversas e bloqueado de
//   proposito, para nao perder o historico);
// - canal que ja e Meta Cloud: troca a credencial. Sem isso, um Access Token
//   revogado ou rotacionado so poderia ser trocado mexendo no banco.
//
// A conferencia usa o telefone do proprio canal, entao credencial de outro
// numero e recusada antes de qualquer alteracao.
router.post('/:id/meta-cloud-credentials', requireAuth, requireIntegrationsAccess, async (req, res) => {
  const channel = await findChannelById(req.params.id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const { phoneNumberId, accessToken, wabaId } = req.body || {};
  if (!phoneNumberId || !accessToken || !wabaId) {
    return res.status(400).json({ error: 'phoneNumberId, accessToken and wabaId are required for meta_cloud channels' });
  }

  const check = await checkMetaCloudSetup({ phoneNumberId, accessToken, wabaId, phoneNumber: channel.phoneNumber });
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }

  if (channel.type === 'baileys') {
    await baileysManager.stopBaileysChannel(channel.id);
  }
  try {
    const converted = await convertChannelToMetaCloud(channel.id, { phoneNumberId, accessToken, wabaId });
    return res.json(toChannelResponse(converted));
  } catch (err) {
    // O indice unique do phoneNumberId impede apontar dois canais para o mesmo
    // numero; sem tratar, isso vazaria como 500 em vez de um recado util.
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'Esse Phone Number ID já está em uso por outro canal.' });
    }
    throw err;
  }
});

router.patch('/:id', requireAuth, requireIntegrationsAccess, async (req, res) => {
  const { name, triageEnabled, wabaId, hidden, welcomeMessage, aiEnabled, aiTriageEnabled, aiNightModeEnabled } = req.body || {};
  if (
    name === undefined &&
    triageEnabled === undefined &&
    wabaId === undefined &&
    hidden === undefined &&
    welcomeMessage === undefined &&
    aiEnabled === undefined &&
    aiTriageEnabled === undefined &&
    aiNightModeEnabled === undefined
  ) {
    return res.status(400).json({ error: 'name, triageEnabled, wabaId, hidden, welcomeMessage, aiEnabled, aiTriageEnabled or aiNightModeEnabled is required' });
  }
  // Canal sem nome fica impossivel de distinguir na lista e no cabecalho da
  // conversa, entao vazio (ou so espacos) e recusado em vez de gravado.
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  if (typeof name === 'string' && name.trim().length > 120) {
    return res.status(400).json({ error: 'name must be 120 characters or fewer' });
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'hidden must be a boolean' });
  }
  if (aiEnabled !== undefined && typeof aiEnabled !== 'boolean') {
    return res.status(400).json({ error: 'aiEnabled must be a boolean' });
  }
  if (aiTriageEnabled !== undefined && typeof aiTriageEnabled !== 'boolean') {
    return res.status(400).json({ error: 'aiTriageEnabled must be a boolean' });
  }
  if (aiNightModeEnabled !== undefined && typeof aiNightModeEnabled !== 'boolean') {
    return res.status(400).json({ error: 'aiNightModeEnabled must be a boolean' });
  }
  if (welcomeMessage !== undefined && welcomeMessage !== null && typeof welcomeMessage !== 'string') {
    return res.status(400).json({ error: 'welcomeMessage must be a string' });
  }
  if (typeof welcomeMessage === 'string' && welcomeMessage.trim().length > 4096) {
    return res.status(400).json({ error: 'welcomeMessage must be 4096 characters or fewer' });
  }
  let channel;
  if (triageEnabled !== undefined) {
    if (typeof triageEnabled !== 'boolean') {
      return res.status(400).json({ error: 'triageEnabled must be a boolean' });
    }
    channel = await updateChannelTriageEnabled(req.params.id, triageEnabled);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  if (wabaId !== undefined) {
    if (typeof wabaId !== 'string' || !wabaId.trim()) {
      return res.status(400).json({ error: 'wabaId must be a non-empty string' });
    }
    channel = await updateChannelWabaId(req.params.id, wabaId.trim());
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found or not an official channel (meta_cloud or 360dialog)' });
    }
  }
  if (hidden !== undefined) {
    const existing = await findChannelById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    // A hidden channel is out of use: it must not keep holding a live WhatsApp
    // session, and it is skipped when connections are started on boot.
    if (hidden && existing.type === 'baileys') {
      await baileysManager.stopBaileysChannel(existing.id);
    }
    channel = await updateChannelHidden(req.params.id, hidden);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  if (name !== undefined) {
    channel = await updateChannelName(req.params.id, name.trim());
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  if (welcomeMessage !== undefined) {
    const normalizedWelcomeMessage = typeof welcomeMessage === 'string' ? welcomeMessage.trim() || null : null;
    channel = await updateChannelWelcomeMessage(req.params.id, normalizedWelcomeMessage);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  if (aiEnabled !== undefined) {
    channel = await updateChannelAiEnabled(req.params.id, aiEnabled);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    // I3 (revisão final do branch inteiro): desligar aiEnabled sem também
    // desligar aiTriageEnabled deixava a coluna aiTriageEnabled=true órfã no
    // banco — um religar futuro do aiEnabled reativaria a triagem por IA sem
    // ninguém ter escolhido isso de novo.
    if (aiEnabled === false) {
      channel = await updateChannelAiTriageEnabled(req.params.id, false);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      // Pela mesma razão: o modo noturno depende da triagem, então desligar a
      // IA não pode deixar o interruptor do noturno ligado no banco.
      channel = await updateChannelAiNightModeEnabled(req.params.id, false);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
    }
  }
  if (aiTriageEnabled !== undefined) {
    const existing = await findChannelById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (!existing.aiEnabled) {
      return res.status(400).json({ error: 'aiTriageEnabled requires aiEnabled' });
    }
    channel = await updateChannelAiTriageEnabled(req.params.id, aiTriageEnabled);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    // Sem triagem não existe modo noturno: quem desliga uma desliga o outro.
    if (aiTriageEnabled === false) {
      channel = await updateChannelAiNightModeEnabled(req.params.id, false);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
    }
  }
  if (aiNightModeEnabled !== undefined) {
    const existing = await findChannelById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (aiNightModeEnabled === true && !(existing.aiEnabled && existing.aiTriageEnabled)) {
      return res.status(400).json({ error: 'aiNightModeEnabled requires aiTriageEnabled' });
    }
    // Sem janela (os dois campos vazios no cartão "Triagem com IA") o modo
    // noturno nunca ativa: isNightModeActive exige início E fim. Ligar o
    // interruptor assim deixaria o canal dizendo "ligado" sem atender ninguém,
    // e o admin só descobriria de manhã. Desligar continua livre.
    if (aiNightModeEnabled === true) {
      const aiConfig = await getAiConfig();
      if (!aiConfig || !aiConfig.nightStartTime || !aiConfig.nightEndTime) {
        return res.status(400).json({ error: 'aiNightModeEnabled requires the night window (nightStartTime/nightEndTime) in the AI triage config' });
      }
    }
    channel = await updateChannelAiNightModeEnabled(req.params.id, aiNightModeEnabled);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  res.json(toChannelResponse(channel));
});

router.post('/:id/reconnect', requireAuth, requireIntegrationsAccess, async (req, res) => {
  const channel = await findChannelById(req.params.id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys') {
    return res.status(400).json({ error: 'Only baileys channels connect through a QR code' });
  }
  await baileysManager.reconnectBaileysChannel(channel);
  const updated = await findChannelById(req.params.id);
  res.json(toChannelResponse(updated || channel));
});

router.delete('/:id', requireAuth, requireIntegrationsAccess, async (req, res) => {
  const channel = await findChannelById(req.params.id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const dependents = await countChannelDependents(channel.id);
  if (dependents.conversations > 0 || dependents.integrations > 0) {
    return res.status(409).json({
      error:
        'Este canal já tem conversas ou uma integração SGP e não pode ser excluído sem perder esse histórico. Use Ocultar.',
    });
  }
  if (channel.type === 'baileys') {
    await baileysManager.stopBaileysChannel(channel.id);
  }
  await deleteChannel(channel.id);
  res.sendStatus(204);
});

router.get('/:id/qr', authenticateQrRoute, async (req, res) => {
  const channel = await findChannelById(req.params.id);
  if (!channel || channel.type !== 'baileys' || channel.status !== 'awaiting_qr') {
    return res.status(404).json({ error: 'No QR code available for this channel' });
  }
  const qr = baileysManager.getQrForChannel(channel.id);
  if (!qr) {
    return res.status(404).json({ error: 'No QR code available for this channel' });
  }
  const qrImageDataUrl = await QRCode.toDataURL(qr);
  res.status(200).send(`<!DOCTYPE html>
<html>
<head>
<title>QR - ${channel.name}</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100%; }
</style>
</head>
<body>
<img src="${qrImageDataUrl}" alt="QR code - ${channel.name}" />
</body>
</html>`);
});

module.exports = router;
