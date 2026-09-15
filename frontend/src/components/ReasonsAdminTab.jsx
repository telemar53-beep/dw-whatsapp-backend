import { useState } from 'react';
import { useReasonsAdmin } from '../hooks/useReasonsAdmin';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../hooks/useConfirm';
import { updateReason } from '../services/api';
import CreateReasonForm from './CreateReasonForm';
import SectionHelp from './SectionHelp';
import { AsyncState } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';

function ReasonRow({ reason, usedByAi, onSaved }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
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
    if (reason.active && usedByAi) {
      const ok = await confirm('A IA vai parar de encerrar sozinha até outro motivo ser escolhido. Desativar mesmo assim?', { danger: true, confirmLabel: 'Desativar mesmo assim' });
      if (!ok) return;
    }
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
        className="space-y-2 rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
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
        <div className="flex items-center gap-2">
          <p className="font-medium text-wa-text">{reason.name}</p>
          {usedByAi && (
            <span className="rounded-full bg-wa-chip px-2 py-[2px] text-[11.5px] font-medium text-wa-chip-text">Usado pela IA ao encerrar</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
            Editar
          </button>
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            className="text-sm font-medium text-wa-muted hover:text-wa-text hover:underline disabled:opacity-50"
          >
            {reason.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>
      {toggleError && (
        <p className="mt-2 rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{toggleError}</p>
      )}
      {confirmDialog}
    </div>
  );
}

function ReasonsAdminTab({ creating: creatingProp, onCreatingChange, aiResolvedReasonId = null } = {}) {
  const { reasons, status, refresh } = useReasonsAdmin();
  const [internalCreating, setInternalCreating] = useState(false);
  const controlled = creatingProp !== undefined;
  const creatingReason = controlled ? creatingProp : internalCreating;
  const setCreatingReason = controlled ? onCreatingChange : setInternalCreating;

  return (
    <div className="space-y-6">
      {!controlled && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreatingReason(true)}
            className="rounded-lg border border-wa-border bg-wa-field px-3 py-1.5 text-sm font-medium text-wa-text transition hover:bg-wa-panel"
          >
            Criar motivo
          </button>
          <SectionHelp label="Motivos" title="Motivos de contato">
            <p>
              Lista de motivos que o atendente escolhe ao encerrar um atendimento — fica
              registrado no histórico e aparece agrupado no Relatório, em "Motivos de
              Contato".
            </p>
            <p className="mt-2 italic">Exemplo: "Troca de senha", "Pagamento - sem conexão".</p>
          </SectionHelp>
        </div>
      )}
      {creatingReason && (
        <CreateReasonForm
          onCreated={() => {
            refresh();
            setCreatingReason(false);
          }}
          onCancel={() => setCreatingReason(false)}
        />
      )}
      <AsyncState status={status} isEmpty={reasons.length === 0} emptyMessage="Nenhum motivo cadastrado ainda.">
        <div className="space-y-3">
          {reasons.map((reason) => (
            <ReasonRow key={reason.id} reason={reason} usedByAi={reason.id === aiResolvedReasonId} onSaved={refresh} />
          ))}
        </div>
      </AsyncState>
    </div>
  );
}

export default ReasonsAdminTab;
