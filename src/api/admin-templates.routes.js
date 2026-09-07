const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listTemplates } = require('../templates/template.repository');
const { createTemplate, deleteTemplate, syncTemplatesForWaba, TemplateValidationError } = require('../templates/template.service');

const router = express.Router();

function metaErrorMessage(err) {
  return err.response && err.response.data && err.response.data.error && err.response.data.error.message;
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const templates = await listTemplates();
  res.json(templates);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, name, category, language, bodyText } = req.body || {};
  if (!channelId || !name || !category || !language || !bodyText) {
    return res.status(400).json({ error: 'channelId, name, category, language and bodyText are required' });
  }
  try {
    const template = await createTemplate({ channelId, name, category, language, bodyText });
    res.status(201).json(template);
  } catch (err) {
    if (err instanceof TemplateValidationError) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A template with this name and language already exists for this WABA' });
    }
    const metaMessage = metaErrorMessage(err);
    if (metaMessage) {
      return res.status(502).json({ error: metaMessage });
    }
    throw err;
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteTemplate(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.status(204).send();
});

router.post('/sync', requireAuth, requireRole('admin'), async (req, res) => {
  const { wabaId } = req.body || {};
  if (!wabaId) {
    return res.status(400).json({ error: 'wabaId is required' });
  }
  try {
    const templates = await syncTemplatesForWaba(wabaId);
    res.json(templates);
  } catch (err) {
    if (err instanceof TemplateValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const metaMessage = metaErrorMessage(err);
    if (metaMessage) {
      return res.status(502).json({ error: metaMessage });
    }
    throw err;
  }
});

module.exports = router;
