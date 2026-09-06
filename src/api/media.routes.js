const express = require('express');
const { verifyToken } = require('../auth/auth.service');
const { findMessageById } = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');

const router = express.Router();

function authenticateMediaRoute(req, res, next) {
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

router.get('/:messageId', authenticateMediaRoute, async (req, res) => {
  const message = await findMessageById(req.params.messageId);
  if (!message || !message.mediaPath) {
    return res.status(404).json({ error: 'Media not found' });
  }
  res.sendFile(getMediaFilePath(message.mediaPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Media not found' });
    }
  });
});

module.exports = router;
