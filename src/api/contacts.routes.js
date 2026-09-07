const express = require('express');
const { verifyToken } = require('../auth/auth.service');
const { requireAuth } = require('../auth/auth.middleware');
const { findContactById, updateContact } = require('../conversations/contact.repository');
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

router.patch('/:id', requireAuth, async (req, res) => {
  const { displayName: rawDisplayName, cityId } = req.body || {};
  if (rawDisplayName !== undefined && rawDisplayName !== null && typeof rawDisplayName !== 'string') {
    return res.status(400).json({ error: 'displayName must be a string or null' });
  }
  const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() || null : null;
  const contact = await updateContact(req.params.id, { displayName, cityId: cityId || null });
  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  res.json(contact);
});

module.exports = router;
