const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listCities, findCityById } = require('../cities/city.repository');
const { listCityNoticesByCityIds, upsertCityNotice, deleteCityNotice } = require('../city-notices/city-notice.repository');

const router = express.Router();

router.get('/notices', requireAuth, requireRole('admin'), async (req, res) => {
  const cities = await listCities();
  const notices = await listCityNoticesByCityIds(cities.map((city) => city.id));
  const noticeByCityId = new Map(notices.map((notice) => [notice.cityId, notice]));
  res.json(
    cities.map((city) => {
      const notice = noticeByCityId.get(city.id);
      return {
        id: city.id,
        name: city.name,
        notice: notice ? { message: notice.message, enabled: notice.enabled } : null,
      };
    })
  );
});

router.patch('/:id/notice', requireAuth, requireRole('admin'), async (req, res) => {
  const { message, enabled } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.trim().length > 4096) {
    return res.status(400).json({ error: 'message must be 4096 characters or fewer' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const city = await findCityById(req.params.id);
  if (!city) {
    return res.status(404).json({ error: 'City not found' });
  }
  const notice = await upsertCityNotice(req.params.id, { message: message.trim(), enabled });
  res.json(notice);
});

router.delete('/:id/notice', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteCityNotice(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Notice not found' });
  }
  res.status(204).send();
});

module.exports = router;
