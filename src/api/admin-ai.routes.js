const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getAiConfig, updateAiConfig, listToolPermissions, setToolPermission } = require('../ai/ai-config.repository');
const { listTools, findTool } = require('../ai/tool-registry');
const { listModels } = require('../ai/openai-client');

const router = express.Router();
const MODOS = ['disabled', 'assistant', 'automatic'];

function toConfigResponse(config) {
  return {
    configured: Boolean(config.apiKey),
    apiKeyLast4: config.apiKey ? config.apiKey.slice(-4) : null,
    model: config.model,
    mode: config.mode,
    systemPrompt: config.systemPrompt,
    maxToolsPerInteraction: config.maxToolsPerInteraction,
  };
}

router.get('/config', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getAiConfig();
  res.json(toConfigResponse(config));
});

router.put('/config', requireAuth, requireRole('admin'), async (req, res) => {
  const { apiKey, model, mode, systemPrompt } = req.body || {};
  if (typeof model !== 'string') {
    return res.status(400).json({ error: 'model is required' });
  }
  if (!MODOS.includes(mode)) {
    return res.status(400).json({ error: 'mode must be disabled, assistant or automatic' });
  }
  // Phase 1 does not include automatic mode: the worker would run the whole turn
  // (OpenAI tokens, SGP calls, side-effecting tools) and then discard the text,
  // sending nothing and creating no suggestion. Blocked here at the API boundary;
  // the CHECK constraint and the worker's automatic branch stay as-is for Phase 2.
  if (mode === 'automatic') {
    return res.status(400).json({ error: 'Automatic mode is not available yet' });
  }
  const existing = await getAiConfig();
  const hasKey = typeof apiKey === 'string' && apiKey.trim().length > 0;
  if (!existing.apiKey && !hasKey && mode !== 'disabled') {
    return res.status(400).json({ error: 'apiKey is required' });
  }
  const config = await updateAiConfig({
    apiKey: hasKey ? apiKey.trim() : null,
    model: model.trim(),
    mode,
    systemPrompt: typeof systemPrompt === 'string' && systemPrompt.trim() ? systemPrompt.trim() : null,
  });
  res.json(toConfigResponse(config));
});

router.post('/test-connection', requireAuth, requireRole('admin'), async (req, res) => {
  const { apiKey } = req.body || {};
  const existing = await getAiConfig();
  const chave = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : existing.apiKey;
  if (!chave) {
    return res.json({ ok: false, error: 'No API key configured' });
  }
  try {
    const models = await listModels(chave);
    res.json({ ok: true, models });
  } catch (err) {
    // Falha de conexão é resultado do teste, não erro da rota.
    res.json({ ok: false, error: err.message });
  }
});

router.get('/tools', requireAuth, requireRole('admin'), async (req, res) => {
  const permissoes = await listToolPermissions();
  const porNome = new Map(permissoes.map((p) => [p.toolName, p.enabled]));
  res.json(
    listTools().map((tool) => ({
      nome: tool.nome,
      categoria: tool.categoria,
      descricao: tool.descricao,
      enabled: porNome.get(tool.nome) === true,
    }))
  );
});

router.put('/tools/:nome', requireAuth, requireRole('admin'), async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  if (!findTool(req.params.nome)) {
    return res.status(404).json({ error: 'Tool not found' });
  }
  const permission = await setToolPermission(req.params.nome, enabled);
  res.json(permission);
});

module.exports = router;
