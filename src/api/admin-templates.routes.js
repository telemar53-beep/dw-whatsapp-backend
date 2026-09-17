const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listTemplates, updateTemplatePurpose } = require('../templates/template.repository');
const { createTemplate, deleteTemplate, syncTemplatesForWaba, registerExistingTemplate, TemplateValidationError } = require('../templates/template.service');

const router = express.Router();

function metaErrorMessage(err) {
  const error = err.response && err.response.data && err.response.data.error;
  if (!error) {
    return null;
  }
  let detail = null;
  if (error.error_user_msg) {
    detail = error.error_user_title ? `${error.error_user_title}: ${error.error_user_msg}` : error.error_user_msg;
  } else if (error.error_data && error.error_data.details) {
    detail = error.error_data.details;
  } else if (error.message) {
    detail = error.message;
  }
  return detail ? `A Meta recusou: ${detail}` : null;
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const templates = await listTemplates();
  res.json(templates);
});

// A finalidade separa o que o atendente vê ao iniciar uma conversa do que é
// usado em disparo (campanha e envios do SGP). Valor desconhecido é recusado:
// aceitar esconderia o template de todas as telas sem ninguém notar.
const PURPOSES = ['atendimento', 'disparo'];

function invalidPurpose(purpose) {
  return purpose !== undefined && !PURPOSES.includes(purpose);
}

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, name, category, language, bodyText, purpose, buttons } = req.body || {};
  if (!channelId || !name || !category || !language || !bodyText) {
    return res.status(400).json({ error: 'channelId, name, category, language and bodyText are required' });
  }
  if (invalidPurpose(purpose)) {
    return res.status(400).json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` });
  }
  if (buttons !== undefined && !Array.isArray(buttons)) {
    return res.status(400).json({ error: 'buttons must be a list of texts' });
  }
  try {
    const template = await createTemplate({ channelId, name, category, language, bodyText, purpose, buttons });
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

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { purpose } = req.body || {};
  if (purpose === undefined) {
    return res.status(400).json({ error: 'purpose is required' });
  }
  if (invalidPurpose(purpose)) {
    return res.status(400).json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` });
  }
  const template = await updateTemplatePurpose(req.params.id, purpose);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.json(template);
});

router.post('/register-existing', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, name, language, headerType } = req.body || {};
  if (!channelId || !name || !language) {
    return res.status(400).json({ error: 'channelId, name and language are required' });
  }
  try {
    const template = await registerExistingTemplate({ channelId, name, language, headerType: headerType || null });
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
