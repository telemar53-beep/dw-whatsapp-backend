const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} = require('../quick-replies/quick-reply.repository');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { title: rawTitle, content: rawContent } = req.body || {};
  const title = (rawTitle || '').trim();
  const content = (rawContent || '').trim();
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  const quickReply = await createQuickReply({ title, content });
  res.status(201).json(quickReply);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { title: rawTitle, content: rawContent } = req.body || {};
  const title = (rawTitle || '').trim();
  const content = (rawContent || '').trim();
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  const quickReply = await updateQuickReply(req.params.id, { title, content });
  if (!quickReply) {
    return res.status(404).json({ error: 'Quick reply not found' });
  }
  res.json(quickReply);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteQuickReply(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Quick reply not found' });
  }
  res.status(204).send();
});

module.exports = router;
