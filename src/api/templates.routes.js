const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listApprovedTemplatesForChannel } = require('../templates/template.service');

const router = express.Router();

const PURPOSES = ['atendimento', 'disparo'];

router.get('/', requireAuth, async (req, res) => {
  const { channelId, purpose } = req.query;
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }
  // Finalidade desconhecida é recusada em vez de ignorada: ignorar devolveria a
  // lista inteira, e um template de disparo apareceria para o atendente por
  // causa de um erro de digitação.
  if (purpose !== undefined && !PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` });
  }
  const templates = await listApprovedTemplatesForChannel(channelId, purpose);
  res.json(templates);
});

module.exports = router;
