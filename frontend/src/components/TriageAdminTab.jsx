import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTriage } from '../hooks/useTriage';
import { useSectors } from '../hooks/useSectors';
import { updateTriageOption, deleteTriageOption } from '../services/api';
import TriageConfigForm from './TriageConfigForm';
import CreateTriageOptionForm from './CreateTriageOptionForm';
import SectionHelp from './SectionHelp';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';

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
      <form
        onSubmit={handleSave}
        className="space-y-3 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <input
          type="number"
          min="1"
          value={optionNumber}
          onChange={(e) => setOptionNumber(e.target.value)}
          className={`w-32 ${inputClass}`}
          required
        />
        <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className={inputClass} required>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          className={inputClass}
          placeholder="financeiro, conta, fatura, boleto"
        />
        {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink-950">
            {option.optionNumber} - {option.sectorName}
          </p>
          <p className="text-sm text-ink-950/55">{option.keywords.join(', ') || 'Sem frases-gatilho'}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}
    </div>
  );
}

function TriageAdminTab() {
  const { config, options, refresh } = useTriage();
  const [creatingOption, setCreatingOption] = useState(false);

  if (!config) {
    return <p className="text-sm text-ink-950/55">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      {options.length === 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2 text-sm text-amber-800">
          Nenhuma opção cadastrada — a triagem não será executada em nenhum canal, mesmo com o toggle ligado.
        </p>
      )}
      <TriageConfigForm config={config} onSaved={refresh} />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreatingOption(true)}
            className="rounded-lg border border-ink-950/15 bg-white/60 px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-white/90"
          >
            Criar opção
          </button>
          <SectionHelp label="Triagem" title="Triagem">
            <p>
              Cada opção é um item do menu automático mostrado ao cliente na primeira
              mensagem. Ele escolhe pelo número ou digitando uma palavra-chave, e a
              conversa entra direto na fila do setor certo.
            </p>
            <p className="mt-2 italic">
              Exemplo: opção 1 → Financeiro, palavras-chave: fatura, boleto, conta,
              pagamento.
            </p>
          </SectionHelp>
        </div>
        {creatingOption && (
          <CreateTriageOptionForm
            onCreated={() => {
              refresh();
              setCreatingOption(false);
            }}
            onCancel={() => setCreatingOption(false)}
          />
        )}
      </div>
      <div className="space-y-3">
        {options.map((option) => (
          <TriageOptionRow key={option.id} option={option} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
    </div>
  );
}

export default TriageAdminTab;
