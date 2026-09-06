import { useState, useRef } from 'react';

function MessageInput({ onSend }) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!content.trim() && !file) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content, file);
      setContent('');
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="hidden"
          id="message-file-input"
        />
        <label
          htmlFor="message-file-input"
          className="cursor-pointer rounded border border-gray-300 px-3 py-2"
          title="Anexar arquivo"
        >
          📎
        </label>
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
      {file && <p className="mt-1 text-sm text-gray-600">Anexo: {file.name}</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </form>
  );
}

export default MessageInput;
