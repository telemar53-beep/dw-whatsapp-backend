const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getCompanyConfig, upsertCompanyConfig } = require('../company/company-config.repository');

const router = express.Router();

const TAMANHO_MAXIMO_NOME = 80;
const MAXIMO_DE_NOMES = 20;

function toResponse(config) {
  return {
    id: config.id,
    name: config.name,
    acceptedPayeeNames: config.acceptedPayeeNames,
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getCompanyConfig();
  res.json(toResponse(config));
});

router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, acceptedPayeeNames } = req.body || {};
  // Nome vazio é válido (o sistema sai sem empresa cadastrada e os textos caem
  // no genérico); o que não vale é outro tipo ou um nome que não caberia na tela.
  if (typeof name !== 'string' || name.length > TAMANHO_MAXIMO_NOME) {
    return res.status(400).json({ error: `name must be a string with at most ${TAMANHO_MAXIMO_NOME} characters` });
  }
  if (!Array.isArray(acceptedPayeeNames) || acceptedPayeeNames.length > MAXIMO_DE_NOMES) {
    return res.status(400).json({ error: `acceptedPayeeNames must be an array with at most ${MAXIMO_DE_NOMES} items` });
  }
  if (acceptedPayeeNames.some((n) => typeof n !== 'string' || n.length > TAMANHO_MAXIMO_NOME)) {
    return res.status(400).json({ error: `each accepted payee name must be a string with at most ${TAMANHO_MAXIMO_NOME} characters` });
  }
  const config = await upsertCompanyConfig({ name, acceptedPayeeNames });
  res.json(toResponse(config));
});

module.exports = router;
