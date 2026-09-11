const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getBusinessHoursConfig, upsertBusinessHoursConfig } = require('../business-hours/business-hours.repository');

const router = express.Router();

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toResponse(config) {
  return {
    id: config.id,
    enabled: config.enabled,
    startTime: config.startTime,
    endTime: config.endTime,
    message: config.message,
  };
}

function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getBusinessHoursConfig();
  res.json(toResponse(config));
});

router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { enabled, startTime, endTime, message } = req.body || {};
  if (typeof startTime !== 'string' || !TIME_PATTERN.test(startTime)) {
    return res.status(400).json({ error: 'startTime must be in HH:MM format' });
  }
  if (typeof endTime !== 'string' || !TIME_PATTERN.test(endTime)) {
    return res.status(400).json({ error: 'endTime must be in HH:MM format' });
  }
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return res.status(400).json({ error: 'endTime must be after startTime' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  const config = await upsertBusinessHoursConfig({ enabled: Boolean(enabled), startTime, endTime, message });
  res.json(toResponse(config));
});

module.exports = router;
