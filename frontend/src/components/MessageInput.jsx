import { useState } from 'react';

function MessageInput({ onSend }) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      await onSend(content);
      setContent('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t border-gray-200 p-3">
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
    </form>
  );
}

export default MessageInput;
