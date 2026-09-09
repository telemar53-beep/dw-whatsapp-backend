const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const {
  listChannels,
  createChannel,
  findChannelById,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  countChannelDependents,
  deleteChannel,
} = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';

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
  if (req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

function toChannelResponse(channel) {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
    hidden: channel.hidden,
    welcomeMessage: channel.welcomeMessage,
    wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const channels = await listChannels({ includeHidden: req.query.includeHidden === 'true' });
  res.json(channels.map(toChannelResponse));
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
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
      const channel = await createChannel({ type, name, phoneNumber, config: { phoneNumberId, accessToken, wabaId } });
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

  return res.status(400).json({ error: 'type must be meta_cloud or baileys' });
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { triageEnabled, wabaId, hidden, welcomeMessage } = req.body || {};
  if (triageEnabled === undefined && wabaId === undefined && hidden === undefined && welcomeMessage === undefined) {
    return res.status(400).json({ error: 'triageEnabled, wabaId, hidden or welcomeMessage is required' });
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'hidden must be a boolean' });
  }
  if (welcomeMessage !== undefined && typeof welcomeMessage !== 'string') {
    return res.status(400).json({ error: 'welcomeMessage must be a string' });
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
      return res.status(404).json({ error: 'Channel not found or not a meta_cloud channel' });
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
  if (welcomeMessage !== undefined) {
    channel = await updateChannelWelcomeMessage(req.params.id, welcomeMessage.trim() || null);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
  }
  res.json(toChannelResponse(channel));
});

router.post('/:id/reconnect', requireAuth, requireRole('admin'), async (req, res) => {
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

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const channel = await findChannelById(req.params.id);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  const dependents = await countChannelDependents(channel.id);
  if (dependents.conversations > 0 || dependents.integrations > 0) {
    return res.status(409).json({
      error:
        'This channel already has conversations or an SGP integration and cannot be deleted without losing that history. Hide it instead.',
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
