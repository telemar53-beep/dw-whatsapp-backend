const express = require('express');
const { requireAuth, hasAdminLevelAccess } = require('../auth/auth.middleware');
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector, getMetricsByReason } = require('../metrics/metrics.repository');

const router = express.Router();

const PERIOD_HOURS = { today: 24, '7d': 7 * 24, '30d': 30 * 24 };
const CUSTOM_DAYS_MAX = 365;

// Devolve o recorte e, no periodo personalizado, o numero de dias que o
// produziu. Sai da mesma funcao de proposito: o que o relatorio ecoa e
// exatamente o que entrou na conta, sem chance de rotulo e dados divergirem.
function periodToSlice(period, daysParam) {
  if (period === 'custom') {
    const days = Number(daysParam);
    if (!Number.isInteger(days) || days < 1 || days > CUSTOM_DAYS_MAX) return null;
    return { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), days };
  }
  if (!Object.prototype.hasOwnProperty.call(PERIOD_HOURS, period)) return null;
  const hours = PERIOD_HOURS[period];
  return { since: new Date(Date.now() - hours * 60 * 60 * 1000) };
}

router.get('/', requireAuth, async (req, res) => {
  const slice = periodToSlice(req.query.period, req.query.days);
  if (!slice) {
    return res.status(400).json({ error: `period must be one of: today, 7d, 30d, or custom with a days parameter from 1 to ${CUSTOM_DAYS_MAX}` });
  }

  const { since, days } = slice;
  // days so existe no periodo personalizado; nos periodos fixos a chave nao
  // entra no payload, que segue com a forma de sempre.
  const recorte = days === undefined ? { period: req.query.period } : { period: req.query.period, days };

  if (hasAdminLevelAccess(req.agent)) {
    const [byAgent, bySector, byReason] = await Promise.all([
      getMetricsForAllAgents(since),
      getMetricsBySector(since),
      getMetricsByReason(since),
    ]);
    return res.json({ ...recorte, scope: 'admin', byAgent, bySector, byReason });
  }

  const own = await getMetricsForAgent(req.agent.agentId, since);
  res.json({ ...recorte, scope: 'agent', own });
});

module.exports = router;
