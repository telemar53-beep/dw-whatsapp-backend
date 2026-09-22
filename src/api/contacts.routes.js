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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Texto vira null quando fica vazio depois do trim: apagar o campo pela
// interface é mandar string em branco, e isso continua valendo.
function textoOuNulo(valor) {
  return typeof valor === 'string' ? valor.trim() || null : null;
}

router.patch('/:id', requireAuth, async (req, res) => {
  const body = req.body || {};
  const { displayName: rawDisplayName, cityId, internalNote: rawInternalNote } = body;
  if (rawDisplayName !== undefined && rawDisplayName !== null && typeof rawDisplayName !== 'string') {
    return res.status(400).json({ error: 'displayName must be a string or null' });
  }
  if (rawInternalNote !== undefined && rawInternalNote !== null && typeof rawInternalNote !== 'string') {
    return res.status(400).json({ error: 'internalNote must be a string or null' });
  }
  // cityId não tinha validação nenhuma: um valor que não fosse uuid descia até
  // o Postgres e virava 500, quando é erro do cliente.
  if (cityId !== undefined && cityId !== null && (typeof cityId !== 'string' || !UUID_PATTERN.test(cityId))) {
    return res.status(400).json({ error: 'cityId must be a UUID or null' });
  }

  // Só entra no patch o que veio no corpo: chave ausente não pode virar null,
  // senão editar o nome apagaria a cidade e a nota interna (ADR-011).
  const patch = {};
  if ('displayName' in body) patch.displayName = textoOuNulo(rawDisplayName);
  if ('cityId' in body) patch.cityId = cityId ?? null;
  if ('internalNote' in body) patch.internalNote = textoOuNulo(rawInternalNote);

  const contact = await updateContact(req.params.id, patch);
  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  // Só o que a edição de cliente usa. O repositório devolve a linha inteira,
  // com telefone, caminho do avatar e os campos do SGP (inclusive o documento);
  // nada disso tem por que voltar numa resposta de edição.
  res.json({
    id: contact.id,
    displayName: contact.displayName,
    cityId: contact.cityId,
    internalNote: contact.internalNote,
  });
});

module.exports = router;
