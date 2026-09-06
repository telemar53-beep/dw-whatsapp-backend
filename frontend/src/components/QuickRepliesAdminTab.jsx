import { useState } from 'react';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import { updateQuickReply, deleteQuickReply } from '../services/api';
import CreateQuickReplyForm from './CreateQuickReplyForm';

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
      <form onSubmit={handleSave} className="space-y-2 rounded border border-gray-200 p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
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
          <p className="font-medium text-gray-800">{quickReply.title}</p>
          <p className="text-sm text-gray-500">{quickReply.content}</p>
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
