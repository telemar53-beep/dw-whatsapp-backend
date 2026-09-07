const express = require('express');
const { verifyToken } = require('../auth/auth.service');
const { findContactById } = require('../conversations/contact.repository');
const { getMediaFilePath } = require('../media/media-storage');

const router = express.Router();

function authenticateContactRoute(req, res, next) {
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

router.get('/:contactId/avatar', authenticateContactRoute, async (req, res) => {
  const contact = await findContactById(req.params.contactId);
  if (!contact || !contact.avatarPath) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  res.type('image/jpeg');
  res.sendFile(getMediaFilePath(contact.avatarPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Avatar not found' });
    }
  });
});

module.exports = router;
