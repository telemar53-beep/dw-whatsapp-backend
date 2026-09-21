import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { updateTriageConfig } from '../services/api';
import { Button, Field } from './ui';
import { descreverErro } from '../utils/errorMessages';

const inputClass =
  'rounded-xl border border-wa-border bg-wa-field px-3.5 py-2 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-focus-ring/40';
const labelClass = 'mb-1 block text-sm font-medium text-wa-muted';

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
      setError(descreverErro(err, 'Falha ao salvar'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="settings-open-form border-b border-white/[0.09] pb-4"
    >
      <h3 className="mb-3 font-display text-[17px] font-semibold text-wa-text">Pergunta de triagem</h3>
      <div className="settings-menu-text-fields grid gap-3 lg:grid-cols-2 lg:gap-4">
        <div className="min-w-0">
          <label htmlFor="triage-question" className={labelClass}>
            Pergunta (a lista de opções é adicionada automaticamente abaixo dela)
          </label>
          <textarea
            id="triage-question"
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            rows={2}
            className={`block w-full min-h-[72px] max-h-60 resize-y [field-sizing:content] ${inputClass}`}
            required
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="triage-confirmation" className={labelClass}>
            Mensagem de confirmação
          </label>
          <textarea
            id="triage-confirmation"
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            rows={2}
            className={`block w-full min-h-[72px] max-h-60 resize-y [field-sizing:content] ${inputClass}`}
            required
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="w-full sm:w-auto">
          <Field id="triage-max-attempts" label="Tentativas antes de cair na fila geral" width="xs">
          <input
            id="triage-max-attempts"
            type="number"
            min="1"
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            className={inputClass}
            required
          />
          </Field>
        </div>
        <Button type="submit" size="sm" loading={submitting}>
          Salvar
        </Button>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      {success && (
        <p className="rounded-lg border border-wa-chip-text/30 bg-wa-chip px-3 py-2 text-sm text-wa-chip-text">
          Configuração salva.
        </p>
      )}
    </form>
  );
}

export default TriageConfigForm;
