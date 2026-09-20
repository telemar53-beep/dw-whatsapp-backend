import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../hooks/useConfirm';
import { setChannelWelcomeMessage } from '../../services/api';

function ChannelWelcomeMessageRow({ channel, onSaved, readOnly = false }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(channel.welcomeMessage || '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function handleEditClick() {
    setText(channel.welcomeMessage || '');
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setText(channel.welcomeMessage || '');
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await setChannelWelcomeMessage(channel.id, text, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await confirm(`Remover a boas-vindas do canal "${channel.name}"?`, { danger: true, confirmLabel: 'Remover' }))) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await setChannelWelcomeMessage(channel.id, '', token);
      onSaved();
    } catch (err) {
      setDeleteError((err.body && err.body.error) || 'Falha ao excluir');
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <li className="p-3.5">
        <form onSubmit={handleSave} className="space-y-2">
          <p className="text-[13.5px] font-medium text-wa-text">{channel.name}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-[10px] border border-wa-border bg-wa-field px-3 py-2 text-[13.5px] text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60"
            required
          />
          {error && <p className="rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-[13px] text-wa-error-text">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-[10px] bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-[10px] border border-wa-border bg-wa-surface px-3 py-1.5 text-[13px] font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
            >
              Cancelar
            </button>
          </div>
        </form>
      </li>
    );
  }

  if (!channel.welcomeMessage) {
    return (
      <li className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <p className="truncate text-[13.5px] text-wa-text">{channel.name}</p>
        {readOnly ? (
          <span className="shrink-0 text-[12.5px] text-wa-warn-text">Requer permissão de Canais e Integrações</span>
        ) : (
          <button onClick={handleEditClick} className="shrink-0 text-[13px] font-medium text-wa-link hover:text-wa-link/80 hover:underline">
            Criar boas-vindas
          </button>
        )}
      </li>
    );
  }

  return (
    <li className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-wa-text">{channel.name}</p>
          <p className="truncate text-[12.5px] text-wa-muted">{channel.welcomeMessage}</p>
        </div>
        {readOnly ? (
          <span className="shrink-0 text-[12.5px] text-wa-warn-text">Requer permissão de Canais e Integrações</span>
        ) : (
          <div className="flex shrink-0 items-center gap-3">
            <button onClick={handleEditClick} className="text-[13px] font-medium text-wa-link hover:text-wa-link/80 hover:underline">
              Editar
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-[13px] font-medium text-wa-error-text hover:text-wa-error-text hover:underline disabled:opacity-50"
            >
              Excluir
            </button>
          </div>
        )}
      </div>
      {deleteError && (
        <p className="mt-2 rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-[12.5px] text-wa-error-text">{deleteError}</p>
      )}
      {confirmDialog}
    </li>
  );
}

export default ChannelWelcomeMessageRow;
