import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { updateTriageConfig } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

function TriageConfigForm({ config, onSaved }) {
  const { token } = useAuth();
  const [questionText, setQuestionText] = useState(config.questionText);
  const [confirmationText, setConfirmationText] = useState(config.confirmationText);
  const [maxAttempts, setMaxAttempts] = useState(String(config.maxAttempts));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setQuestionText(config.questionText);
    setConfirmationText(config.confirmationText);
    setMaxAttempts(String(config.maxAttempts));
  }, [config]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await updateTriageConfig({ questionText, confirmationText, maxAttempts: Number(maxAttempts) }, token);
      setSuccess(true);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-wa-text">Pergunta de triagem</h3>
      <div>
        <label htmlFor="triage-question" className={labelClass}>
          Pergunta (a lista de opções é adicionada automaticamente abaixo dela)
        </label>
        <textarea
          id="triage-question"
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="triage-confirmation" className={labelClass}>
          Mensagem de confirmação
        </label>
        <textarea
          id="triage-confirmation"
          value={confirmationText}
          onChange={(e) => setConfirmationText(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="triage-max-attempts" className={labelClass}>
          Tentativas antes de cair na fila geral
        </label>
        <input
          id="triage-max-attempts"
          type="number"
          min="1"
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(e.target.value)}
          className={`w-32 ${inputClass}`}
          required
        />
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      {success && (
        <p className="rounded-lg border border-wa-chip-text/30 bg-wa-chip px-3 py-2 text-sm text-wa-chip-text">
          Configuração salva.
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
      >
        Salvar
      </button>
    </form>
  );
}

export default TriageConfigForm;
