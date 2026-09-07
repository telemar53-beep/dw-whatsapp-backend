const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
} = require('../triage/triage.repository');

const router = express.Router();

function normalizeKeywords(keywords) {
  return Array.isArray(keywords) ? keywords.map((k) => (k || '').trim()).filter(Boolean) : [];
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getTriageConfig();
  const options = await listTriageOptions();
  res.json({ ...config, options });
});

router.put('/config', requireAuth, requireRole('admin'), async (req, res) => {
  const { questionText: rawQuestionText, confirmationText: rawConfirmationText, maxAttempts } = req.body || {};
  const questionText = (rawQuestionText || '').trim();
  const confirmationText = (rawConfirmationText || '').trim();
  if (!questionText || !confirmationText) {
    return res.status(400).json({ error: 'questionText and confirmationText are required' });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    return res.status(400).json({ error: 'maxAttempts must be a positive integer' });
  }
  const config = await updateTriageConfig({ questionText, confirmationText, maxAttempts });
  res.json(config);
});

router.post('/options', requireAuth, requireRole('admin'), async (req, res) => {
  const { optionNumber, sectorId, keywords } = req.body || {};
  if (!Number.isInteger(optionNumber) || optionNumber < 1) {
    return res.status(400).json({ error: 'optionNumber must be a positive integer' });
  }
  if (!sectorId) {
    return res.status(400).json({ error: 'sectorId is required' });
  }
  try {
    const option = await createTriageOption({ optionNumber, sectorId, keywords: normalizeKeywords(keywords) });
    res.status(201).json(option);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An option with this number already exists' });
    }
    throw err;
  }
});

router.patch('/options/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { optionNumber, sectorId, keywords } = req.body || {};
  if (!Number.isInteger(optionNumber) || optionNumber < 1) {
    return res.status(400).json({ error: 'optionNumber must be a positive integer' });
  }
  if (!sectorId) {
    return res.status(400).json({ error: 'sectorId is required' });
  }
  try {
    const option = await updateTriageOption(req.params.id, { optionNumber, sectorId, keywords: normalizeKeywords(keywords) });
    if (!option) {
      return res.status(404).json({ error: 'Triage option not found' });
    }
    res.json(option);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An option with this number already exists' });
    }
    throw err;
  }
});

router.delete('/options/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteTriageOption(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Triage option not found' });
  }
  res.status(204).send();
});

module.exports = router;
