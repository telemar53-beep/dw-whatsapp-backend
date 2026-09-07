import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { updateTriageConfig } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

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
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Pergunta de triagem</h3>
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
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-700">
          Configuração salva.
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Salvar
      </button>
    </form>
  );
}

export default TriageConfigForm;
