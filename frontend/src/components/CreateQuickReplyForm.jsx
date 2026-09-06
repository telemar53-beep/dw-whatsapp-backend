import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createQuickReply } from '../services/api';

function CreateQuickReplyForm({ onCreated }) {
  const { token } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createQuickReply({ title, content }, token);
      setTitle('');
      setContent('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar resposta rápida');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-800">Cadastrar nova resposta rápida</h3>
      <div>
        <label htmlFor="quick-reply-title" className="mb-1 block text-sm text-gray-600">
          Título
        </label>
        <input
          id="quick-reply-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      <div>
        <label htmlFor="quick-reply-content" className="mb-1 block text-sm text-gray-600">
          Mensagem
        </label>
        <textarea
          id="quick-reply-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
        Cadastrar
      </button>
    </form>
  );
}

export default CreateQuickReplyForm;
