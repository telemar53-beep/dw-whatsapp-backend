import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../hooks/useConfirm';
import { updateQuickReply, deleteQuickReply } from '../../services/api';
import { inputClass, Button } from '../ui';
import { descreverErro } from '../../utils/errorMessages';

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
      setError(descreverErro(err, 'Falha ao salvar'));
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
      setDeleteError(descreverErro(err, 'Falha ao excluir'));
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-3 rounded-[14px] border border-chat-orange/30 bg-white/[0.04] p-4"
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
          <Button variant="secondary" size="sm" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" loading={submitting}>
            Salvar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="border-b border-white/[0.08] px-2 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-wa-text">{quickReply.title}</p>
          <p className="text-sm text-wa-muted">{quickReply.content}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleEditClick}>
            Editar
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
            Excluir
          </Button>
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
