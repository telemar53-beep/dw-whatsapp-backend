import { useState } from 'react';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import { updateQuickReply, deleteQuickReply } from '../services/api';
import CreateQuickReplyForm from './CreateQuickReplyForm';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';

function QuickReplyRow({ quickReply, onSaved, onDeleted }) {
  const { token } = useAuth();
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
    if (!window.confirm(`Excluir a resposta rápida "${quickReply.title}"?`)) {
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
        className="space-y-2 rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl"
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
          <p className="font-medium text-ink-950">{quickReply.title}</p>
          <p className="text-sm text-ink-950/55">{quickReply.content}</p>
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

function QuickRepliesAdminTab() {
  const { quickReplies, refresh } = useQuickReplies();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {quickReplies.map((quickReply) => (
          <QuickReplyRow key={quickReply.id} quickReply={quickReply} onSaved={refresh} onDeleted={refresh} />
        ))}
      </div>
      <CreateQuickReplyForm onCreated={refresh} />
    </div>
  );
}

export default QuickRepliesAdminTab;
