const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector, getMetricsByReason } = require('../metrics/metrics.repository');

const router = express.Router();

const PERIOD_HOURS = { today: 24, '7d': 7 * 24, '30d': 30 * 24 };
const CUSTOM_DAYS_MAX = 365;

function periodToSince(period, daysParam) {
  if (period === 'custom') {
    const days = Number(daysParam);
    if (!Number.isInteger(days) || days < 1 || days > CUSTOM_DAYS_MAX) return null;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
  if (!Object.prototype.hasOwnProperty.call(PERIOD_HOURS, period)) return null;
  const hours = PERIOD_HOURS[period];
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

router.get('/', requireAuth, async (req, res) => {
  const since = periodToSince(req.query.period, req.query.days);
  if (!since) {
    return res.status(400).json({ error: `period must be one of: today, 7d, 30d, or custom with a days parameter from 1 to ${CUSTOM_DAYS_MAX}` });
  }

  if (req.agent.role === 'admin') {
    const [byAgent, bySector, byReason] = await Promise.all([
      getMetricsForAllAgents(since),
      getMetricsBySector(since),
      getMetricsByReason(since),
    ]);
    return res.json({ period: req.query.period, scope: 'admin', byAgent, bySector, byReason });
  }

  const own = await getMetricsForAgent(req.agent.agentId, since);
  res.json({ period: req.query.period, scope: 'agent', own });
});

module.exports = router;
