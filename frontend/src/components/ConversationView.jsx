import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { claimConversation, closeConversation } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import MessageStatusTicks from './MessageStatusTicks';
import ConversationHistoryModal from './ConversationHistoryModal';
import ContactAvatar from './ContactAvatar';
import EditContactModal from './EditContactModal';

function ConversationView({ conversation, onTransferClick, onBack }) {
  const { token, agent } = useAuth();
  const { messages, sendMessage } = useConversationMessages(conversation.id);
  const { quickReplies } = useQuickReplies();
  const [showingHistory, setShowingHistory] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactOverride, setContactOverride] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  useEffect(() => {
    setContactOverride(null);
    setEditingContact(false);
    setReplyingTo(null);
  }, [conversation.id]);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isMine = conversation.assignedAgentId === agent.id;
  const displayName = contactOverride ? contactOverride.displayName : conversation.contactDisplayName;
  const cityName = contactOverride ? contactOverride.cityName : conversation.contactCityName;
  const nameLabel = displayName || conversation.contactPhoneNumber || 'Conversa';
  const headerLabel = cityName ? `${nameLabel} - ${cityName}` : nameLabel;

  async function handleSend(content, file, repliedToMessageId) {
    await sendMessage(content, file, repliedToMessageId);
    setReplyingTo(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded p-3 text-gray-500 md:hidden" aria-label="Voltar para a lista">
            ←
          </button>
          <button
            onClick={() => setEditingContact(true)}
            className="flex items-center gap-2"
            aria-label={`Editar cliente: ${headerLabel}`}
          >
            <ContactAvatar
              contactId={conversation.contactId}
              avatarPath={conversation.contactAvatarPath}
              displayName={displayName}
              phoneNumber={conversation.contactPhoneNumber}
            />
            <span className="font-semibold text-gray-800">{headerLabel}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
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
        {messages.map((message) => {
          const repliedToLabel = message.repliedToPreview
            ? message.repliedToPreview.direction === 'outbound'
              ? 'Você'
              : displayName || conversation.contactPhoneNumber || 'Conversa'
            : null;
          return (
            <div
              key={message.id}
              className={`max-w-[85%] space-y-1 rounded px-3 py-2 text-sm md:max-w-xs ${
                message.direction === 'inbound' ? 'bg-gray-100 text-gray-800' : 'ml-auto bg-blue-100 text-gray-800'
              }`}
            >
              {message.repliedToPreview && (
                <div className="rounded border-l-2 border-gray-400 bg-black/5 px-2 py-1 text-xs text-gray-600">
                  <p className="font-medium">{repliedToLabel}</p>
                  <p className="truncate">{message.repliedToPreview.content}</p>
                </div>
              )}
              {message.content && <p className="break-words">{message.content}</p>}
              <MessageAttachment message={message} />
              <div className="flex items-center justify-end gap-2">
                {isMine && message.content && (
                  <button
                    onClick={() => setReplyingTo(message)}
                    aria-label="Responder"
                    title="Responder"
                    className="text-xs text-gray-500 hover:underline"
                  >
                    ↩
                  </button>
                )}
                {message.direction === 'outbound' && <MessageStatusTicks status={message.status} />}
              </div>
            </div>
          );
        })}
      </div>
      {isMine && (
        <MessageInput
          onSend={handleSend}
          quickReplies={quickReplies}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      )}
      {showingHistory && (
        <ConversationHistoryModal contactId={conversation.contactId} onClose={() => setShowingHistory(false)} />
      )}
      {editingContact && (
        <EditContactModal
          conversation={{
            ...conversation,
            contactDisplayName: contactOverride ? contactOverride.displayName : conversation.contactDisplayName,
            contactCityId: contactOverride ? contactOverride.cityId : conversation.contactCityId,
          }}
          onClose={() => setEditingContact(false)}
          onSaved={(updated) => setContactOverride(updated)}
        />
      )}
    </div>
  );
}

export default ConversationView;
