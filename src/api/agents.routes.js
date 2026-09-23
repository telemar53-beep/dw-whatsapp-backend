const express = require('express');
const { autenticarLeituraDeMidia } = require('../auth/media-auth.middleware');
const multer = require('multer');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents, findAgentById, updateAgentProfile, setAgentAvatarPath } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');
const { countAssignedConversationsByAgent } = require('../conversations/conversation.repository');
const { saveAvatarImage, getMediaFilePath } = require('../media/media-storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

router.get('/', requireAuth, async (req, res) => {
  const [agents, activeCounts] = await Promise.all([listAgents(), countAssignedConversationsByAgent()]);
  res.json(
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      avatarPath: agent.avatarPath,
      online: isAgentOnline(agent.id),
      lastSeenAt: agent.lastSeenAt || null,
      activeConversations: activeCounts[agent.id] || 0,
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
  // Comprime antes de gravar: o limite de upload é 5 MB, e foto de celular
  // chega nesse tamanho para ser pintada em 68px no maior uso da tela.
  const { avatarPath } = await saveAvatarImage(file.buffer, file.mimetype);
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

router.get('/:id/avatar', autenticarLeituraDeMidia, async (req, res) => {
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
