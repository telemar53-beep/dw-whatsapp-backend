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
    <li className="px-0.5">
      <button
        onClick={() => onSelect(conversation.id)}
        className={`flex w-full items-center gap-4 rounded-[18px] p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 ${
          selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
        }`}
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
          size={52}
          dark
        />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px]">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[16px] leading-[22px] text-chat-text">{displayLabel}</span>
            {messageTime && (
              <span className={`shrink-0 text-[12.5px] leading-[16px] ${unread ? 'font-medium text-chat-orange' : 'text-chat-faint'}`}>
                {messageTime}
              </span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 text-[14px] leading-[20px] text-chat-muted">
              {conversation.lastMessageDirection === 'outbound' && (
                <MessageStatusTicks status={conversation.lastMessageStatus} />
              )}
              <span className="truncate">{previewText}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {conversation.assignedAgentName && (
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-[1px] text-[11px] font-medium text-chat-muted">
                  {conversation.assignedAgentName}
                </span>
              )}
              {conversation.sectorName && (
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-[1px] text-[11px] font-medium text-chat-muted">
                  {conversation.sectorName}
                </span>
              )}
              {unread && (
                <span
                  title="Mensagem não lida"
                  className="h-[11px] w-[11px] shrink-0 rounded-full bg-chat-orange"
                />
              )}
            </span>
          </span>
        </span>
      </button>
      {/* A conversa aberta é um cartão inteiro; as demais ficam separadas por um fio. */}
      {!selected && <span aria-hidden="true" className="mx-4 block h-px bg-white/[0.07]" />}
    </li>
  );
}

export default ConversationListItem;
