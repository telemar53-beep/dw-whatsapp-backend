const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('../integrations/sgp-client');

const router = express.Router();

function handleSgpError(err, res) {
  if (err instanceof SgpNotConfiguredError) return res.status(400).json({ error: 'SGP integration is not configured' });
  if (err instanceof SgpDisabledError) return res.status(400).json({ error: 'SGP integration is not enabled' });
  if (err instanceof SgpClientNotFoundError) return res.status(404).json({ error: 'Client not found' });
  if (err instanceof SgpRequestError) return res.status(502).json({ error: 'Failed to reach SGP' });
  throw err;
}

router.get('/clientes', requireAuth, async (req, res) => {
  const cpf = typeof req.query.cpf === 'string' ? req.query.cpf.replace(/\D/g, '') : '';
  if (!cpf) {
    return res.status(400).json({ error: 'cpf is required' });
  }
  try {
    const result = await lookupClientByCpf(cpf);
    res.json(result);
  } catch (err) {
    handleSgpError(err, res);
  }
});

router.post('/contratos/:contratoId/boleto', requireAuth, async (req, res) => {
  try {
    const result = await getDuplicateInvoice(req.params.contratoId);
    res.json(result);
  } catch (err) {
    handleSgpError(err, res);
  }
});

module.exports = router;
