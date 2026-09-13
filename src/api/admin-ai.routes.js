const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, listToolPermissions, setToolPermission } = require('../ai/ai-config.repository');
const { listTools, findTool } = require('../ai/tool-registry');
const { listModels } = require('../ai/openai-client');
const { findReasonById } = require('../reasons/reason.repository');

const router = express.Router();
const MODOS = ['disabled', 'assistant', 'automatic'];
// Mesmo formato exigido em conversations.routes.js: sem os hifens nas posições
// certas o valor chega ao Postgres e vira erro de cast (22P02), não uma recusa.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toConfigResponse(config) {
  return {
    configured: Boolean(config.apiKey),
    apiKeyLast4: config.apiKey ? config.apiKey.slice(-4) : null,
    model: config.model,
    mode: config.mode,
    systemPrompt: config.systemPrompt,
    maxToolsPerInteraction: config.maxToolsPerInteraction,
    transcriptionEnabled: config.transcriptionEnabled,
    transcriptionModel: config.transcriptionModel,
    transcriptionMaxSeconds: config.transcriptionMaxSeconds,
    transcriptionMaxBytes: config.transcriptionMaxBytes,
    transcriptionPrompt: config.transcriptionPrompt,
    transcriptionFeedAi: config.transcriptionFeedAi,
    triageConfidenceThreshold: config.triageConfidenceThreshold,
    triageMaxQuestions: config.triageMaxQuestions,
    triageTimeoutMinutes: config.triageTimeoutMinutes,
    triageExtraInstructions: config.triageExtraInstructions,
    triageResolvedReasonId: config.triageResolvedReasonId || null,
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

router.put('/transcription', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds,
    transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi,
  } = req.body || {};

  if (typeof transcriptionEnabled !== 'boolean') {
    return res.status(400).json({ error: 'transcriptionEnabled must be a boolean' });
  }
  if (typeof transcriptionFeedAi !== 'boolean') {
    return res.status(400).json({ error: 'transcriptionFeedAi must be a boolean' });
  }
  if (typeof transcriptionModel !== 'string') {
    return res.status(400).json({ error: 'transcriptionModel is required' });
  }
  if (!Number.isInteger(transcriptionMaxSeconds) || transcriptionMaxSeconds <= 0) {
    return res.status(400).json({ error: 'transcriptionMaxSeconds must be a positive integer' });
  }
  if (!Number.isInteger(transcriptionMaxBytes) || transcriptionMaxBytes <= 0) {
    return res.status(400).json({ error: 'transcriptionMaxBytes must be a positive integer' });
  }
  if (typeof transcriptionPrompt !== 'string') {
    return res.status(400).json({ error: 'transcriptionPrompt must be a string' });
  }
  // Ligar sem modelo deixaria a transcrição habilitada e inerte, exatamente o
  // estado que shouldTranscribe recusa em silêncio.
  if (transcriptionEnabled && !transcriptionModel.trim()) {
    return res.status(400).json({ error: 'transcriptionModel is required when transcription is enabled' });
  }

  const config = await updateTranscriptionConfig({
    transcriptionEnabled,
    transcriptionModel: transcriptionModel.trim(),
    transcriptionMaxSeconds,
    transcriptionMaxBytes,
    transcriptionPrompt,
    transcriptionFeedAi,
  });
  res.json(toConfigResponse(config));
});

router.put('/triage', requireAuth, requireRole('admin'), async (req, res) => {
  const { triageConfidenceThreshold, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions } = req.body || {};
  // I2 (revisão final do branch inteiro): Number(null) é 0, Number('') é 0 e
  // Number(false) é 0 — os três passavam batidos pela checagem de faixa como
  // se o admin tivesse digitado 0% de confiança mínima, em vez de recusar um
  // valor que não veio como número nem como texto de número.
  const tipoValido = typeof triageConfidenceThreshold === 'number'
    || (typeof triageConfidenceThreshold === 'string' && triageConfidenceThreshold.trim() !== '');
  if (!tipoValido) return res.status(400).json({ error: 'triageConfidenceThreshold must be a number between 0 and 1' });
  const t = Number(triageConfidenceThreshold);
  if (!Number.isFinite(t) || t < 0 || t > 1) return res.status(400).json({ error: 'triageConfidenceThreshold must be between 0 and 1' });
  if (!Number.isInteger(triageMaxQuestions) || triageMaxQuestions < 0 || triageMaxQuestions > 5) return res.status(400).json({ error: 'triageMaxQuestions must be an integer from 0 to 5' });
  if (!Number.isInteger(triageTimeoutMinutes) || triageTimeoutMinutes < 1 || triageTimeoutMinutes > 60) return res.status(400).json({ error: 'triageTimeoutMinutes must be an integer from 1 to 60' });
  if (typeof triageExtraInstructions !== 'string') return res.status(400).json({ error: 'triageExtraInstructions must be a string' });
  // O motivo é o que autoriza a IA a ENCERRAR sozinha: um id qualquer (ou de
  // um motivo desativado) deixaria o encerramento gravando um motivo que o
  // Relatório não sabe explicar. Vazio/ausente = desligado, e é legítimo.
  const { triageResolvedReasonId } = req.body || {};
  let motivoResolvido = null;
  if (triageResolvedReasonId !== undefined && triageResolvedReasonId !== null && triageResolvedReasonId !== '') {
    const erroMotivo = { error: 'triageResolvedReasonId must be null or an active reason id' };
    if (typeof triageResolvedReasonId !== 'string' || !UUID_PATTERN.test(triageResolvedReasonId)) {
      return res.status(400).json(erroMotivo);
    }
    const motivo = await findReasonById(triageResolvedReasonId);
    if (!motivo || !motivo.active) return res.status(400).json(erroMotivo);
    motivoResolvido = motivo.id;
  }
  const config = await updateTriageConfig({ triageConfidenceThreshold: t, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions, triageResolvedReasonId: motivoResolvido });
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
