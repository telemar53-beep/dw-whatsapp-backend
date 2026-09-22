const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listarPlanosDisponiveis } = require('../plans/plan.repository');

const router = express.Router();

// Resposta OPERACIONAL: so os planos ativos, e sem a observacao interna. A
// separacao e estrutural — a chave `note` nao existe nesta resposta, entao nao
// ha o que vazar. Ver plan.repository.js.
router.get('/', requireAuth, async (req, res) => {
  const planos = await listarPlanosDisponiveis();
  res.json(planos);
});

module.exports = router;
