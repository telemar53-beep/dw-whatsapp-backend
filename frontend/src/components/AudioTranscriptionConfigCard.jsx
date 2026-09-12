import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAiConfig } from '../hooks/useAiConfig';
import { updateTranscriptionConfig, testAiConnection } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

const BYTES_POR_MB = 1048576;

function AudioTranscriptionConfigCard() {
  const { token } = useAuth();
  const { config, refresh } = useAiConfig();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [maxMinutes, setMaxMinutes] = useState(5);
  const [maxMb, setMaxMb] = useState(25);
  const [feedAi, setFeedAi] = useState(true);
  const [vocabulary, setVocabulary] = useState('');
  const [testedModels, setTestedModels] = useState([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A tela trabalha em minutos e MB; o banco guarda segundos e bytes. A conversão
  // acontece só nas duas bordas: aqui ao carregar, e no handleSave ao gravar.
  useEffect(() => {
    setEnabled(Boolean(config.transcriptionEnabled));
    setModel(config.transcriptionModel || '');
    setFeedAi(config.transcriptionFeedAi !== false);
    setVocabulary(config.transcriptionPrompt || '');
    if (config.transcriptionMaxSeconds) setMaxMinutes(Math.round(config.transcriptionMaxSeconds / 60));
    if (config.transcriptionMaxBytes) setMaxMb(Math.round(config.transcriptionMaxBytes / BYTES_POR_MB));
  }, [config]);

  const modelOptions = Array.from(new Set([config.transcriptionModel, model, ...testedModels].filter(Boolean)));

  async function handleFetchModels() {
    setError(null);
    setTesting(true);
    try {
      // A chave já está salva: o backend a lê do banco quando nenhuma é enviada.
      const result = await testAiConnection(undefined, token);
      if (result.ok) setTestedModels(result.models || []);
      else setError(result.error || 'Falha ao buscar modelos');
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao buscar modelos');
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    // Ligar sem modelo deixaria a transcrição habilitada e inerte — o mesmo
    // estado que shouldTranscribe recusa em silêncio no backend.
    if (enabled && !model.trim()) {
      setError('Modelo é obrigatório');
      return;
    }
    setSaving(true);
    try {
      await updateTranscriptionConfig(
        {
          transcriptionEnabled: enabled,
          transcriptionModel: model.trim(),
          transcriptionMaxSeconds: Number(maxMinutes) * 60,
          transcriptionMaxBytes: Number(maxMb) * BYTES_POR_MB,
          transcriptionPrompt: vocabulary,
          transcriptionFeedAi: feedAi,
        },
        token
      );
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Transcrição de áudio</h3>
      <p className="text-sm text-wa-muted">
        Converte os áudios recebidos em texto e entrega o texto à IA, que responde como se o
        cliente tivesse digitado.
      </p>

      <label className="flex items-center gap-2 text-sm text-wa-text">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Transcrever áudios automaticamente
      </label>

      <div>
        <label htmlFor="transcription-model" className={labelClass}>Modelo</label>
        <select
          id="transcription-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        >
          <option value="">Selecione um modelo</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="transcription-max-minutes" className={labelClass}>Duração máxima (minutos)</label>
          <input
            id="transcription-max-minutes"
            type="number"
            min="1"
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="transcription-max-mb" className={labelClass}>Tamanho máximo (MB)</label>
          <input
            id="transcription-max-mb"
            type="number"
            min="1"
            value={maxMb}
            onChange={(e) => setMaxMb(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-wa-text">
        <input type="checkbox" checked={feedAi} onChange={(e) => setFeedAi(e.target.checked)} />
        Enviar transcrição para a IA
      </label>

      <div>
        <label htmlFor="transcription-vocabulary" className={labelClass}>Vocabulário da operação</label>
        <textarea
          id="transcription-vocabulary"
          rows={3}
          value={vocabulary}
          onChange={(e) => setVocabulary(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-wa-muted">
          Termos que o modelo costuma errar: nomes técnicos, marcas, jargão da operação.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={testing}
          className="rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm font-medium text-wa-text transition hover:bg-wa-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          Buscar modelos
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

export default AudioTranscriptionConfigCard;
