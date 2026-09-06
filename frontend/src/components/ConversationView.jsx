import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { claimConversation, closeConversation } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import ConversationHistoryModal from './ConversationHistoryModal';

function ConversationView({ conversation, onTransferClick }) {
  const { token, agent } = useAuth();
  const { messages, sendMessage } = useConversationMessages(conversation.id);
  const [showingHistory, setShowingHistory] = useState(false);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isMine = conversation.assignedAgentId === agent.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 p-3">
        <h3 className="font-semibold text-gray-800">Conversa</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowingHistory(true)}
            className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700"
          >
            Ver atendimentos anteriores
          </button>
          {isUnassigned && (
            <button
              onClick={() => claimConversation(conversation.id, token)}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white"
            >
              Assumir
            </button>
          )}
          {isMine && (
            <>
              <button
                onClick={() => onTransferClick(conversation.id)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                Transferir
              </button>
              <button
                onClick={() => closeConversation(conversation.id, token)}
                className="rounded bg-gray-600 px-3 py-1 text-sm text-white"
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
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
      {isMine && <MessageInput onSend={sendMessage} />}
      {showingHistory && (
        <ConversationHistoryModal contactId={conversation.contactId} onClose={() => setShowingHistory(false)} />
      )}
    </div>
  );
}

export default ConversationView;
