import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createCity } from '../services/api';

// `embedded`: dentro de um pop-up que já tem título e moldura — sem borda nem h3.
function CreateCityForm({ onCreated, onCancel, embedded = false }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createCity({ name }, token);
      setName('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar cidade');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={embedded ? '' : 'rounded-[16px] border border-wa-border bg-wa-surface p-4'}>
      {!embedded && <h3 className="mb-2.5 text-[13.5px] font-medium text-wa-text">Cadastrar nova cidade</h3>}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="city-name" className="sr-only">
          Nome da cidade
        </label>
        <input
          id="city-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da cidade"
          className="h-10 min-w-0 flex-1 rounded-[10px] border border-wa-border bg-wa-field px-3.5 text-[14px] text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60"
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-10 shrink-0 rounded-[10px] bg-wa-green px-4 text-[13.5px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-10 shrink-0 rounded-[10px] border border-wa-border bg-wa-surface px-3 text-[13.5px] font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        )}
      </form>
      {error && (
        <p className="mt-2 rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-[13px] text-wa-error-text">
          {error}
        </p>
      )}
    </div>
  );
}

export default CreateCityForm;
