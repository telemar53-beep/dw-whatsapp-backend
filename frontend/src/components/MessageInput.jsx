import { useState } from 'react';

function MessageInput({ onSend }) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content);
      setContent('');
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Digite uma mensagem..."
          className="flex-1 rounded border border-gray-300 px-3 py-2"
        />
        <button type="submit" disabled={sending} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
          Enviar
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default MessageInput;
