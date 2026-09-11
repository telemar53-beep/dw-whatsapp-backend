import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { createTriageOption } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';

function CreateTriageOptionForm({ onCreated, onCancel }) {
  const { token } = useAuth();
  const { sectors } = useSectors();
  const [optionNumber, setOptionNumber] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      await createTriageOption({ optionNumber: Number(optionNumber), sectorId, keywords: keywordList }, token);
      setOptionNumber('');
      setSectorId('');
      setKeywords('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar opção');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-wa-text">Cadastrar nova opção</h3>
      <div>
        <label htmlFor="option-number" className={labelClass}>
          Número da opção
        </label>
        <input
          id="option-number"
          type="number"
          min="1"
          value={optionNumber}
          onChange={(e) => setOptionNumber(e.target.value)}
          className={`w-32 ${inputClass}`}
          required
        />
      </div>
      <div>
        <label htmlFor="option-sector" className={labelClass}>
          Setor
        </label>
        <select
          id="option-sector"
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
          className={inputClass}
          required
        >
          <option value="">Selecione um setor</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="option-keywords" className={labelClass}>
          Frases-gatilho (separadas por vírgula)
        </label>
        <input
          id="option-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className={inputClass}
          placeholder="financeiro, conta, fatura, boleto"
        />
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default CreateTriageOptionForm;
