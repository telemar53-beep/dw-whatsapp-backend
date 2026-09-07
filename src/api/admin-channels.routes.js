const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const { listChannels, createChannel, findChannelById, updateChannelTriageEnabled, updateChannelWabaId } = require('../channels/channel.repository');
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

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const channels = await listChannels();
  res.json(
    channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      phoneNumber: channel.phoneNumber,
      status: channel.status,
      triageEnabled: channel.triageEnabled,
      wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
    }))
  );
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
  const { triageEnabled, wabaId } = req.body || {};
  if (triageEnabled === undefined && wabaId === undefined) {
    return res.status(400).json({ error: 'triageEnabled or wabaId is required' });
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
  res.json({
    id: channel.id,
    type: channel.type,
    name: channel.name,
    phoneNumber: channel.phoneNumber,
    status: channel.status,
    triageEnabled: channel.triageEnabled,
    wabaId: channel.type === 'meta_cloud' ? channel.config.wabaId : undefined,
  });
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
