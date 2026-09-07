import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { updateTriageConfig } from '../services/api';

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
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Pergunta de triagem</h3>
      <div>
        <label htmlFor="triage-question" className="mb-1 block text-sm text-gray-600">
          Pergunta (a lista de opções é adicionada automaticamente abaixo dela)
        </label>
        <textarea
          id="triage-question"
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="triage-confirmation" className="mb-1 block text-sm text-gray-600">
          Mensagem de confirmação
        </label>
        <textarea
          id="triage-confirmation"
          value={confirmationText}
          onChange={(e) => setConfirmationText(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="triage-max-attempts" className="mb-1 block text-sm text-gray-600">
          Tentativas antes de cair na fila geral
        </label>
        <input
          id="triage-max-attempts"
          type="number"
          min="1"
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(e.target.value)}
          className="w-32 rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Configuração salva.</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Salvar
      </button>
    </form>
  );
}

export default TriageConfigForm;
