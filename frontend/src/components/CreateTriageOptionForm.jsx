import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import { createTriageOption } from '../services/api';

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
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar nova opção</h3>
      <div>
        <label htmlFor="option-number" className="mb-1 block text-sm text-gray-600">
          Número da opção
        </label>
        <input
          id="option-number"
          type="number"
          min="1"
          value={optionNumber}
          onChange={(e) => setOptionNumber(e.target.value)}
          className="w-32 rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="option-sector" className="mb-1 block text-sm text-gray-600">
          Setor
        </label>
        <select
          id="option-sector"
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
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
        <label htmlFor="option-keywords" className="mb-1 block text-sm text-gray-600">
          Frases-gatilho (separadas por vírgula)
        </label>
        <input
          id="option-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="financeiro, conta, fatura, boleto"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateTriageOptionForm;
