const express = require('express');
const { login, changePassword } = require('./auth.service');
const { requireAuth, hasAdminLevelAccess } = require('./auth.middleware');
const { signMediaToken, MEDIA_TOKEN_EXPIRY_SECONDS } = require('./media-token.service');
const { loginLimiter } = require('../config/rate-limiters');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const result = await login({ email, password });
    res.json(result);
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (err.code === 'ACCOUNT_DISABLED') {
      return res.status(403).json({ error: 'Account disabled' });
    }
    next(err);
  }
});

router.put('/password', requireAuth, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  try {
    await changePassword({ agentId: req.agent.agentId, currentPassword, newPassword });
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'INVALID_CURRENT_PASSWORD') {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    next(err);
  }
});

/**
 * Emite o token de leitura de mídia do agente logado.
 *
 * Uma chamada serve TODOS os recursos dele — avatares da lista, mídias da
 * conversa, download. Um token por recurso multiplicaria as emissões pelo
 * número de bolhas e avatares na tela, que hoje não tem teto.
 *
 * Autentica pelo JWT de sessão no header, como qualquer rota normal: é o único
 * lugar onde os dois tokens se encontram, e a troca acontece por header, nunca
 * por URL.
 */
router.post('/media-token', requireAuth, (req, res, next) => {
  try {
    const token = signMediaToken({
      agentId: req.agent.agentId,
      podeVerSilent: hasAdminLevelAccess(req.agent),
    });
    res.json({ mediaToken: token, expiresInSeconds: MEDIA_TOKEN_EXPIRY_SECONDS });
  } catch (err) {
    if (err.code === 'MEDIA_TOKEN_SECRET_MISSING') {
      console.error('Não foi possível emitir token de mídia', err.message);
      return res.status(503).json({ error: 'Media token is not configured on this server' });
    }
    next(err);
  }
});

module.exports = router;
