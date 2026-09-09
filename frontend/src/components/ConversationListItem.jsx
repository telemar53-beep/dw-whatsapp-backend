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

function ConversationListItem({ conversation, onSelect, unread, selected }) {
  const nameLabel = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const displayLabel = conversation.contactCityName ? `${nameLabel} - ${conversation.contactCityName}` : nameLabel;
  const previewText = getPreviewText(conversation);
  const messageTime = formatMessageTime(conversation.lastMessageAt);

  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className={`flex w-full items-center gap-3 pl-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-wa-green ${
          selected ? 'bg-wa-active' : 'hover:bg-wa-hover'
        }`}
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
          size={49}
        />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-[2px] border-b border-wa-border py-[11px] pr-3">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[17px] leading-[22px] text-wa-text">{displayLabel}</span>
            {messageTime && (
              <span className={`shrink-0 text-[12px] leading-[16px] ${unread ? 'text-wa-badge' : 'text-wa-muted'}`}>
                {messageTime}
              </span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 text-[14px] leading-[20px] text-wa-muted">
              {conversation.lastMessageDirection === 'outbound' && (
                <MessageStatusTicks status={conversation.lastMessageStatus} />
              )}
              <span className="truncate">{previewText}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {conversation.assignedAgentName && (
                <span className="rounded-full bg-wa-badge/15 px-2 py-[1px] text-[11px] font-medium text-wa-badge">
                  {conversation.assignedAgentName}
                </span>
              )}
              {conversation.sectorName && (
                <span className="rounded-full bg-wa-chip px-2 py-[1px] text-[11px] font-medium text-wa-chip-text">
                  {conversation.sectorName}
                </span>
              )}
              {unread && (
                <span
                  title="Mensagem não lida"
                  className="h-[11px] w-[11px] shrink-0 rounded-full bg-wa-badge"
                />
              )}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export default ConversationListItem;
