import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createSector } from '../services/api';
import { Field } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-accent/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

// `embedded`: dentro de um pop-up que já tem título e moldura — sem borda nem h3.
function CreateSectorForm({ onCreated, onCancel, embedded = false }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createSector({ name }, token);
      setName('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar setor');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={embedded ? 'space-y-3' : 'settings-open-form space-y-4 rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 p-5'}
    >
      {!embedded && <h3 className="font-display text-base font-semibold text-wa-text">Cadastrar novo setor</h3>}
      <div>
        <Field id="sector-name" label="Nome" width="md">
          <input id="sector-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        </Field>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[12px] bg-accent px-5 py-2.5 text-[14px] font-medium text-on-accent transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
      </div>
    </form>
  );
}

export default CreateSectorForm;
