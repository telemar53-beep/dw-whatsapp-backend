import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAiConfig } from '../hooks/useAiConfig';
import { updateAiConfig, testAiConnection } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

// Rótulos no masculino ("o modo") — evita colidir, em getByText, com o selo de
// status no feminino ("a integração"), que usa "Desativada"/"Conectada".
const MODE_OPTIONS = [
  { value: 'disabled', label: 'Desativado' },
  { value: 'assistant', label: 'Assistente' },
  { value: 'automatic', label: 'Automático' },
];

const STATUS_BADGE_CLASS = {
  Desativada: 'bg-wa-surface-soft text-wa-muted',
  'Não configurada': 'bg-wa-surface-soft text-wa-muted',
  Erro: 'border border-wa-error-text/30 bg-wa-error-bg text-wa-error-text',
  Conectada: 'bg-wa-green/15 text-wa-green',
};

function computeStatus({ mode, configured, hasError }) {
  if (mode === 'disabled') return 'Desativada';
  if (hasError) return 'Erro';
  if (configured) return 'Conectada';
  return 'Não configurada';
}

function OpenAiConfigCard() {
  const { token } = useAuth();
  const { config, refresh } = useAiConfig();
  const [changingKey, setChangingKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('disabled');
  const [testedModels, setTestedModels] = useState([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setModel(config.model || '');
    setMode(config.mode || 'disabled');
  }, [config]);

  const modelOptions = Array.from(new Set([config.model, model, ...testedModels].filter(Boolean)));
  const status = computeStatus({ mode, configured: config.configured, hasError: Boolean(testError) });
  // Verdadeiro sempre que o campo da chave está editável: na primeira configuração
  // (ainda não há chave salva) ou quando o admin clicou em "Trocar chave".
  const showKeyInput = !config.configured || changingKey;

  async function handleTestConnection() {
    setTestError(null);
    setTesting(true);
    try {
      const result = await testAiConnection(showKeyInput && apiKey.trim() ? apiKey.trim() : undefined, token);
      if (result.ok) {
        setTestedModels(result.models || []);
      } else {
        setTestError(result.error || 'Falha ao testar conexão');
      }
    } catch (err) {
      setTestError((err.body && err.body.error) || 'Falha ao testar conexão');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    if (!model.trim()) {
      setError('Modelo é obrigatório');
      return;
    }
    if (!config.configured && !apiKey.trim() && mode !== 'disabled') {
      setError('Chave da API é obrigatória');
      return;
    }
    setSaving(true);
    try {
      await updateAiConfig(
        { apiKey: showKeyInput && apiKey.trim() ? apiKey.trim() : undefined, model: model.trim(), mode },
        token
      );
      refresh();
      setChangingKey(false);
      setApiKey('');
      setTestError(null);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-wa-text">Integração com OpenAI</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[status]}`}>{status}</span>
      </div>
      <div>
        {!showKeyInput ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-wa-muted">Chave terminando em ...{config.apiKeyLast4}</span>
            <button
              type="button"
              onClick={() => setChangingKey(true)}
              className="text-sm font-medium text-wa-link underline"
            >
              Trocar chave
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="ai-api-key" className={labelClass}>Chave da API</label>
            <input
              id="ai-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputClass}
            />
          </>
        )}
      </div>
      <div>
        <label htmlFor="ai-model" className={labelClass}>Modelo</label>
        <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
          <option value="">Selecione um modelo</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ai-mode" className={labelClass}>Modo</label>
        <select id="ai-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {testError && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{testError}</p>}
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testing}
          className="rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm font-medium text-wa-text transition hover:bg-wa-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          Testar conexão
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </form>
  );
}

export default OpenAiConfigCard;
