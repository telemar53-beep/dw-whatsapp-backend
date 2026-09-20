import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAiConfig } from '../hooks/useAiConfig';
import { updateTranscriptionConfig, testAiConnection } from '../services/api';
import { AsyncState, Button, Field } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-accent/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'settings-transcription-form settings-open-form space-y-3 pb-4';

const BYTES_POR_MB = 1048576;

function AudioTranscriptionConfigCard() {
  const { token } = useAuth();
  const { config, status, refresh } = useAiConfig();
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
  // Enquanto `status` não for 'ready' este efeito ainda não rodou e o formulário
  // nem chega a renderizar (AsyncState mostra um esqueleto no lugar dele) — não
  // há como gravar um default por engano no lugar do valor real.
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
    // Espelha a validação do backend (Number.isInteger(...) > 0) para nunca mandar
    // um 0 (campo vazio) e devolver ao admin o erro em inglês da API.
    const minutos = Number(maxMinutes);
    const mb = Number(maxMb);
    if (!Number.isInteger(minutos) || minutos < 1 || !Number.isInteger(mb) || mb < 1) {
      setError('Duração e tamanho máximos devem ser números inteiros maiores que zero');
      return;
    }
    setSaving(true);
    try {
      await updateTranscriptionConfig(
        {
          transcriptionEnabled: enabled,
          transcriptionModel: model.trim(),
          transcriptionMaxSeconds: minutos * 60,
          transcriptionMaxBytes: mb * BYTES_POR_MB,
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
      <p className="text-[13.5px] leading-5 text-wa-muted">
        O texto transcrito fica disponível ao atendente e pode ser usado pela IA na resposta.
      </p>

      <AsyncState status={status} skeletonLines={4}>
        <div className="grid items-start gap-x-5 gap-y-3 lg:grid-cols-2">
        <section aria-label="Ativação da transcrição" className="border-b border-white/[0.09] pb-3 lg:col-span-2">
          <label className="flex items-center gap-3 text-[14px] font-medium text-wa-text">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Transcrever áudios automaticamente
          </label>
          <p className="ml-7 mt-1 text-[12.5px] text-wa-muted">Áudios recebidos serão convertidos em texto dentro dos limites abaixo.</p>
        </section>

        <section aria-labelledby="transcription-processing-title" className="space-y-3 border-b border-white/[0.09] pb-3 lg:border-b-0 lg:border-r lg:pr-5">
        <div>
          <h2 id="transcription-processing-title" className="font-display text-[16px] font-semibold text-wa-text">Processamento</h2>
          <p className="mt-1 text-[12.5px] text-wa-muted">Modelo e limites aplicados a cada áudio.</p>
        </div>
        <Field id="transcription-model" label="Modelo" width="md">
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
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Minutos e megabytes sao dois digitos: largura de dois digitos. */}
          <Field id="transcription-max-minutes" label="Duração máxima (minutos)" width="xs">
            <input
              id="transcription-max-minutes"
              type="number"
              min="1"
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id="transcription-max-mb" label="Tamanho máximo (MB)" width="xs">
            <input
              id="transcription-max-mb"
              type="number"
              min="1"
              value={maxMb}
              onChange={(e) => setMaxMb(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={handleFetchModels}
          loading={testing}
          disabled={!config.configured}
          title={!config.configured ? 'Salve a chave da OpenAI primeiro' : undefined}
        >
          Buscar modelos
        </Button>
        </section>

        <section aria-labelledby="transcription-ai-title" className="space-y-3 pb-3">
        <h2 id="transcription-ai-title" className="font-display text-[16px] font-semibold text-wa-text">Uso pela IA</h2>
        <label className="flex items-center gap-2 text-sm text-wa-text">
          <input type="checkbox" checked={feedAi} onChange={(e) => setFeedAi(e.target.checked)} />
          Enviar transcrição para a IA
        </label>

        <Field
          id="transcription-vocabulary"
          label="Vocabulário da operação"
          help="Termos que o modelo costuma errar: nomes técnicos, marcas, jargão da operação."
        >
          <textarea
            id="transcription-vocabulary"
            rows={2}
            value={vocabulary}
            onChange={(e) => setVocabulary(e.target.value)}
            className={`${inputClass} min-h-[72px] max-h-56 resize-y [field-sizing:content]`}
          />
        </Field>
        </section>

        </div>
        {error && (
          <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>
        )}

        <div className="flex">
          <Button type="submit" loading={saving}>
            Salvar transcrição
          </Button>
        </div>
      </AsyncState>
    </form>
  );
}

export default AudioTranscriptionConfigCard;
