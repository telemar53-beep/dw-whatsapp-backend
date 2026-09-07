import ContactAvatar from './ContactAvatar';
import MessageStatusTicks from './MessageStatusTicks';

const MEDIA_TYPE_LABELS = {
  image: '📷 Foto',
  audio: '🎤 Áudio',
  video: '🎥 Vídeo',
  document: '📄 Documento',
  sticker: '😀 Figurinha',
  location: '📍 Localização',
};

function getPreviewText(conversation) {
  if (conversation.lastMessageContent) return conversation.lastMessageContent;
  if (conversation.lastMessageType) return MEDIA_TYPE_LABELS[conversation.lastMessageType] || conversation.contactPhoneNumber;
  return conversation.contactPhoneNumber;
}

function formatMessageTime(lastMessageAt) {
  if (!lastMessageAt) return null;
  return new Date(lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function ConversationListItem({ conversation, onSelect }) {
  const nameLabel = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const displayLabel = conversation.contactCityName ? `${nameLabel} - ${conversation.contactCityName}` : nameLabel;
  const previewText = getPreviewText(conversation);
  const messageTime = formatMessageTime(conversation.lastMessageAt);

  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="flex w-full items-center gap-2 rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-medium text-gray-800">{displayLabel}</p>
            <div className="flex shrink-0 items-center gap-2">
              {messageTime && <span className="text-xs text-gray-400">{messageTime}</span>}
              {conversation.sectorName && (
                <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{conversation.sectorName}</span>
              )}
            </div>
          </div>
          <p className="flex items-center gap-1 truncate text-xs text-gray-500">
            {conversation.lastMessageDirection === 'outbound' && (
              <MessageStatusTicks status={conversation.lastMessageStatus} />
            )}
            <span className="truncate">{previewText}</span>
          </p>
        </div>
      </button>
    </li>
  );
}

export default ConversationListItem;
