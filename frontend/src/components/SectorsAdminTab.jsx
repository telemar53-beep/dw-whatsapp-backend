import { useState } from 'react';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { updateSector, deleteSector } from '../services/api';
import CreateSectorForm from './CreateSectorForm';
import { AsyncState } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';

function SectorRow({ sector, onSaved, onDeleted }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sector.name);
  const [aiHint, setAiHint] = useState(sector.aiHint || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateSector(sector.id, { name, aiHint }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setName(sector.name);
    setAiHint(sector.aiHint || '');
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(sector.name);
    setAiHint(sector.aiHint || '');
    setError(null);
    setEditing(false);
  }

  async function handleDelete() {
    const ok = await confirm(`Excluir o setor "${sector.name}"?`, { danger: true, confirmLabel: 'Excluir' });
    if (!ok) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteSector(sector.id, token);
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
        className="space-y-2 rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
        <div>
          <label htmlFor={`sector-ai-hint-${sector.id}`} className="mb-1.5 block text-sm font-medium text-wa-muted">
            Orientação para a IA
          </label>
          <textarea
            id={`sector-ai-hint-${sector.id}`}
            rows={3}
            value={aiHint}
            onChange={(e) => setAiHint(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-wa-green px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="font-medium text-wa-text">{sector.name}</p>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm font-medium text-wa-error-text hover:text-wa-error-text hover:underline disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      </div>
      {deleteError && (
        <p className="mt-2 rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{deleteError}</p>
      )}
      {confirmDialog}
    </div>
  );
}

function SectorsAdminTab({ creating: creatingProp, onCreatingChange } = {}) {
  const { sectors, status: hookStatus, loading, refresh } = useSectors();
  const [internalCreating, setInternalCreating] = useState(false);
  const controlled = creatingProp !== undefined;
  const creating = controlled ? creatingProp : internalCreating;
  const setCreating = controlled ? onCreatingChange : setInternalCreating;
  const status = hookStatus || (loading ? 'loading' : 'ready');

  return (
    <div className="space-y-6">
      <AsyncState status={status} isEmpty={sectors.length === 0} emptyMessage="Nenhum setor cadastrado ainda.">
        <div className="space-y-3">
          {sectors.map((sector) => (
            <SectorRow key={sector.id} sector={sector} onSaved={refresh} onDeleted={refresh} />
          ))}
        </div>
      </AsyncState>
      {(!controlled || creating) && (
        <CreateSectorForm
          onCreated={() => {
            refresh();
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}

export default SectorsAdminTab;
