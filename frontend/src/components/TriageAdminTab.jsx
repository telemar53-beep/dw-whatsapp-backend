import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTriage } from '../hooks/useTriage';
import { useSectors } from '../hooks/useSectors';
import { updateTriageOption, deleteTriageOption } from '../services/api';
import TriageConfigForm from './TriageConfigForm';
import CreateTriageOptionForm from './CreateTriageOptionForm';

function TriageOptionRow({ option, onSaved, onDeleted }) {
  const { token } = useAuth();
  const { sectors } = useSectors();
  const [editing, setEditing] = useState(false);
  const [optionNumber, setOptionNumber] = useState(String(option.optionNumber));
  const [sectorId, setSectorId] = useState(option.sectorId);
  const [keywords, setKeywords] = useState(option.keywords.join(', '));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setOptionNumber(String(option.optionNumber));
    setSectorId(option.sectorId);
    setKeywords(option.keywords.join(', '));
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setOptionNumber(String(option.optionNumber));
    setSectorId(option.sectorId);
    setKeywords(option.keywords.join(', '));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const keywordList = keywords.split(',').map((k) => k.trim()).filter(Boolean);
      await updateTriageOption(option.id, { optionNumber: Number(optionNumber), sectorId, keywords: keywordList }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir a opção ${option.optionNumber} (${option.sectorName})?`)) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTriageOption(option.id, token);
      onDeleted();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="space-y-2 rounded border border-gray-200 p-3">
        <input
          type="number"
          min="1"
          value={optionNumber}
          onChange={(e) => setOptionNumber(e.target.value)}
          className="w-32 rounded border border-gray-300 px-3 py-2"
          required
        />
        <select
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        >
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          placeholder="financeiro, conta, fatura, boleto"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Salvar
          </button>
          <button type="button" onClick={handleCancel} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">
            {option.optionNumber} - {option.sectorName}
          </p>
          <p className="text-sm text-gray-500">{option.keywords.join(', ') || 'Sem frases-gatilho'}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm text-blue-600 underline">
            Editar
          </button>
          <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-600 underline disabled:opacity-50">
            Excluir
          </button>
        </div>
      </div>
      {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

function TriageAdminTab() {
  const { config, options, refresh } = useTriage();

  if (!config) {
    return <p className="text-sm text-gray-500">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <TriageConfigForm config={config} onSaved={refresh} />
      <div className="space-y-3">
        {options.map((option) => (
          <TriageOptionRow key={option.id} option={option} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
      <CreateTriageOptionForm onCreated={refresh} />
    </div>
  );
}

export default TriageAdminTab;
