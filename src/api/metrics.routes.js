const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector } = require('../metrics/metrics.repository');

const router = express.Router();

const PERIOD_HOURS = { today: 24, '7d': 7 * 24, '30d': 30 * 24 };

function periodToSince(period) {
  const hours = PERIOD_HOURS[period];
  if (!hours) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

router.get('/', requireAuth, async (req, res) => {
  const since = periodToSince(req.query.period);
  if (!since) {
    return res.status(400).json({ error: 'period must be one of: today, 7d, 30d' });
  }

  if (req.agent.role === 'admin') {
    const [byAgent, bySector] = await Promise.all([getMetricsForAllAgents(since), getMetricsBySector(since)]);
    return res.json({ period: req.query.period, scope: 'admin', byAgent, bySector });
  }

  const own = await getMetricsForAgent(req.agent.agentId, since);
  res.json({ period: req.query.period, scope: 'agent', own });
});

module.exports = router;
