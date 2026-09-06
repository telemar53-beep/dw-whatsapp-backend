import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getConversationHistory, getMessages } from '../services/api';
import MessageAttachment from './MessageAttachment';

function ConversationHistoryModal({ contactId, onClose }) {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    getConversationHistory(contactId, token)
      .then(setHistory)
      .catch(() => {});
  }, [contactId, token]);

  function openConversation(conversation) {
    setSelected(conversation);
    getMessages(conversation.id, token)
      .then(setMessages)
      .catch(() => {});
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="max-h-[80vh] w-96 overflow-y-auto rounded bg-white p-4 shadow">
        {selected ? (
          <>
            <button onClick={() => setSelected(null)} className="mb-3 text-sm text-blue-600 underline">
              ← Voltar
            </button>
            <h3 className="mb-3 font-semibold text-gray-800">
              Atendimento em {new Date(selected.updatedAt).toLocaleDateString('pt-BR')} — {selected.channelName}
            </h3>
            <div className="space-y-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-xs space-y-1 rounded px-3 py-2 text-sm ${
                    message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
                  }`}
                >
                  {message.content && <p>{message.content}</p>}
                  <MessageAttachment message={message} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-3 font-semibold text-gray-800">Atendimentos anteriores</h3>
            {history.length === 0 && <p className="text-sm text-gray-500">Nenhum atendimento anterior encontrado.</p>}
            <ul className="mb-3 space-y-1">
              {history.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    onClick={() => openConversation(conversation)}
                    className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <p className="text-sm text-gray-800">{new Date(conversation.updatedAt).toLocaleDateString('pt-BR')}</p>
                    <p className="text-xs text-gray-500">{conversation.channelName}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <button onClick={onClose} className="w-full rounded bg-gray-200 py-2 text-sm text-gray-700">
          Fechar
        </button>
      </div>
    </div>
  );
}

export default ConversationHistoryModal;
