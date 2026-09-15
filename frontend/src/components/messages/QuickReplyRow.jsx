import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../hooks/useConfirm';
import { updateQuickReply, deleteQuickReply } from '../../services/api';
import { inputClass } from '../ui';

function QuickReplyRow({ quickReply, onSaved, onDeleted }) {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(quickReply.title);
  const [content, setContent] = useState(quickReply.content);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateQuickReply(quickReply.id, { title, content }, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditClick() {
    setTitle(quickReply.title);
    setContent(quickReply.content);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setTitle(quickReply.title);
    setContent(quickReply.content);
    setError(null);
    setEditing(false);
  }

  async function handleDelete() {
    if (!(await confirm(`Excluir a resposta rápida "${quickReply.title}"?`, { danger: true, confirmLabel: 'Excluir' }))) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteQuickReply(quickReply.id, token);
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
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          required
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={inputClass}
          required
        />
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
        <div>
          <p className="font-medium text-wa-text">{quickReply.title}</p>
          <p className="text-sm text-wa-muted">{quickReply.content}</p>
        </div>
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

export default QuickReplyRow;
