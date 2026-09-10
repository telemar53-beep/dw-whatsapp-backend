const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth/auth.middleware');
const { verifyToken } = require('../auth/auth.service');
const { listAgents, findAgentById, updateAgentProfile, setAgentAvatarPath } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');
const { saveMediaFile, getMediaFilePath, extensionForMimeType } = require('../media/media-storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function authenticateAgentAvatarRoute(req, res, next) {
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
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const agents = await listAgents();
  res.json(
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      avatarPath: agent.avatarPath,
      online: isAgentOnline(agent.id),
    }))
  );
});

router.get('/me', requireAuth, async (req, res) => {
  const agent = await findAgentById(req.agent.agentId);
  res.json({ id: agent.id, name: agent.name, email: agent.email, phone: agent.phone, avatarPath: agent.avatarPath, role: agent.role });
});

router.patch('/me', requireAuth, async (req, res) => {
  const { name, phone } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  const agent = await updateAgentProfile(req.agent.agentId, { name: trimmedName, phone: phone || null });
  res.json({ id: agent.id, name: agent.name, email: agent.email, phone: agent.phone, avatarPath: agent.avatarPath, role: agent.role });
});

router.post('/me/avatar', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'file is required' });
  }
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.mimetype)) {
    return res.status(400).json({ error: 'File must be an image (jpeg, png, webp or gif)' });
  }
  const avatarPath = await saveMediaFile(file.buffer, extensionForMimeType(file.mimetype));
  await setAgentAvatarPath(req.agent.agentId, avatarPath);
  res.status(200).json({ avatarPath });
});

// eslint-disable-next-line no-unused-vars
router.use('/me/avatar', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File exceeds the 5MB upload limit' });
  }
  next(err);
});

router.delete('/me/avatar', requireAuth, async (req, res) => {
  await setAgentAvatarPath(req.agent.agentId, null);
  res.status(200).json({ ok: true });
});

router.get('/:id/avatar', authenticateAgentAvatarRoute, async (req, res) => {
  const agent = await findAgentById(req.params.id);
  if (!agent || !agent.avatarPath) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  res.type('image/jpeg');
  res.sendFile(getMediaFilePath(agent.avatarPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Avatar not found' });
    }
  });
});

module.exports = router;
