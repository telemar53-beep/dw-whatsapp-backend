import { useState } from 'react';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import { updateReason } from '../services/api';
import CreateReasonForm from './CreateReasonForm';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';

function ReasonRow({ reason, onSaved }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(reason.name);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState(null);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateReason(reason.id, { name }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setName(reason.name);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setName(reason.name);
    setError(null);
    setEditing(false);
  }

  async function handleToggleActive() {
    setToggling(true);
    setToggleError(null);
    try {
      await updateReason(reason.id, { active: !reason.active }, token);
      onSaved();
    } catch (err) {
      setToggleError((err.body && err.body.error) || 'Falha ao atualizar o motivo');
    } finally {
      setToggling(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
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
        <p className="font-medium text-ink-950">{reason.name}</p>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            className="text-sm font-medium text-ink-950/60 hover:text-ink-950 hover:underline disabled:opacity-50"
          >
            {reason.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>
      {toggleError && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{toggleError}</p>
      )}
    </div>
  );
}

function ReasonsAdminTab() {
  const { reasons, refresh } = useReasonsAdmin();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {reasons.map((reason) => (
          <ReasonRow key={reason.id} reason={reason} onSaved={refresh} />
        ))}
      </div>
      <CreateReasonForm onCreated={refresh} />
    </div>
  );
}

export default ReasonsAdminTab;
