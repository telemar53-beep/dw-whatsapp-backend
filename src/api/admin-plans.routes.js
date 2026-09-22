const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  listPlansForAdmin, createPlan, updatePlan, deletePlan,
} = require('../plans/plan.repository');

const router = express.Router();

// Preco zero e legitimo (cortesia, comodato). O que nao pode e negativo, texto
// ou ausente.
function precoValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

// Nulo e legitimo: plano de TV ou combo nao tem velocidade, e nulo e mais
// honesto que zero. String tambem nao passa — quem converte e a tela.
function velocidadeValida(valor) {
  if (valor === null || valor === undefined) return true;
  return Number.isInteger(valor) && valor > 0;
}

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const planos = await listPlansForAdmin();
  res.json(planos);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const corpo = req.body || {};

  const name = texto(corpo.name);
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!precoValido(corpo.monthlyPrice)) return res.status(400).json({ error: 'monthlyPrice is invalid' });
  if (!velocidadeValida(corpo.speedMbps)) return res.status(400).json({ error: 'speedMbps is invalid' });
  if ('active' in corpo && typeof corpo.active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  if ('sortOrder' in corpo && !Number.isInteger(corpo.sortOrder)) {
    return res.status(400).json({ error: 'sortOrder is invalid' });
  }

  const plano = await createPlan({
    name,
    speedMbps: corpo.speedMbps === undefined ? null : corpo.speedMbps,
    monthlyPrice: corpo.monthlyPrice,
    installCondition: texto(corpo.installCondition),
    active: 'active' in corpo ? corpo.active : true,
    sortOrder: 'sortOrder' in corpo ? corpo.sortOrder : 0,
    note: texto(corpo.note),
  });
  return res.status(201).json(plano);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const corpo = req.body || {};
  const patch = {};

  // Escrita parcial: so entra no patch a chave que veio no corpo. Valor falso,
  // zero e vazio sao alteracoes legitimas e precisam passar.
  if ('name' in corpo) {
    const name = texto(corpo.name);
    if (!name) return res.status(400).json({ error: 'name is required' });
    patch.name = name;
  }
  if ('monthlyPrice' in corpo) {
    if (!precoValido(corpo.monthlyPrice)) return res.status(400).json({ error: 'monthlyPrice is invalid' });
    patch.monthlyPrice = corpo.monthlyPrice;
  }
  if ('speedMbps' in corpo) {
    if (!velocidadeValida(corpo.speedMbps)) return res.status(400).json({ error: 'speedMbps is invalid' });
    patch.speedMbps = corpo.speedMbps === undefined ? null : corpo.speedMbps;
  }
  if ('active' in corpo) {
    if (typeof corpo.active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
    patch.active = corpo.active;
  }
  if ('sortOrder' in corpo) {
    if (!Number.isInteger(corpo.sortOrder)) return res.status(400).json({ error: 'sortOrder is invalid' });
    patch.sortOrder = corpo.sortOrder;
  }
  if ('installCondition' in corpo) patch.installCondition = texto(corpo.installCondition);
  if ('note' in corpo) patch.note = texto(corpo.note);

  const plano = await updatePlan(req.params.id, patch);
  if (!plano) return res.status(404).json({ error: 'Plan not found' });
  return res.json(plano);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const removido = await deletePlan(req.params.id);
  if (!removido) return res.status(404).json({ error: 'Plan not found' });
  return res.status(204).send();
});

module.exports = router;
