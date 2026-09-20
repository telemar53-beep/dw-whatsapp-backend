import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createReason } from '../services/api';
import { Button, Field } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-accent/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

// `embedded`: dentro de um pop-up que já tem título e moldura — sem borda nem h3.
function CreateReasonForm({ onCreated, onCancel, embedded = false }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createReason({ name }, token);
      setName('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar motivo');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={embedded ? 'space-y-3' : 'settings-open-form space-y-4 rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 p-5'}
    >
      {!embedded && <h3 className="font-display text-base font-semibold text-wa-text">Cadastrar novo motivo</h3>}
      <div>
        <Field id="reason-name" label="Nome" width="md">
          <input id="reason-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        </Field>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          Cadastrar
        </Button>
      </div>
    </form>
  );
}

export default CreateReasonForm;
