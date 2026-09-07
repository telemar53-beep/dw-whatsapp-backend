import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { createTriageOption } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

function CreateTriageOptionForm({ onCreated }) {
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
      className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
    >
      <h3 className="font-display text-base font-semibold text-ink-950">Cadastrar nova opção</h3>
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
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cadastrar
      </button>
    </form>
  );
}

export default CreateTriageOptionForm;
