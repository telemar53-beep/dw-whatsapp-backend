import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent, startConversation } from '../services/api';

function StartConversationModal({ onClose, onCreated }) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('55');
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    listChannelsForAgent(token)
      .then((data) => {
        const eligible = data.filter((channel) => channel.type === 'baileys' && channel.status === 'connected');
        setChannels(eligible);
        if (eligible.length > 0) {
          setChannelId(eligible[0].id);
        }
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const conversation = await startConversation({ channelId, phoneNumber, content }, token);
      onCreated(conversation);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao iniciar conversa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[90vw] max-w-80 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Iniciar conversa</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="start-conversation-channel" className="mb-1 block text-sm text-gray-600">
              Canal
            </label>
            {loading ? (
              <p className="text-sm text-gray-500">Carregando canais...</p>
            ) : loadError ? (
              <p className="text-sm text-red-600">Não foi possível carregar os canais. Feche e tente novamente.</p>
            ) : channels.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum canal Baileys conectado no momento.</p>
            ) : (
              <select
                id="start-conversation-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label htmlFor="start-conversation-phone" className="mb-1 block text-sm text-gray-600">
              Telefone
            </label>
            <input
              id="start-conversation-phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label htmlFor="start-conversation-message" className="mb-1 block text-sm text-gray-600">
              Mensagem
            </label>
            <textarea
              id="start-conversation-message"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || loading || loadError || channels.length === 0}
              className="flex-1 rounded bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
            >
              Iniciar
            </button>
            <button type="button" onClick={onClose} className="flex-1 rounded bg-gray-200 py-2 text-sm text-gray-700">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StartConversationModal;
