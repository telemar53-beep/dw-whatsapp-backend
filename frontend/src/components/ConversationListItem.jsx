import ContactAvatar from './ContactAvatar';
import MessageStatusTicks from './MessageStatusTicks';
import { IconCheckCircle } from './icons/WaIcons';

const MEDIA_TYPE_LABELS = {
  image: '📷 Foto',
  audio: '🎤 Áudio',
  video: '🎥 Vídeo',
  document: '📄 Documento',
  sticker: '😀 Figurinha',
  location: '📍 Localização',
  pix: '💠 Pix',
};

function getPreviewText(conversation) {
  // O conteúdo de uma mensagem 'pix' é o código copia e cola — nunca deve aparecer
  // na prévia da lista, então esse tipo é checado antes do lastMessageContent.
  if (conversation.lastMessageType === 'pix') return MEDIA_TYPE_LABELS.pix;
  if (conversation.lastMessageContent) return conversation.lastMessageContent;
  if (conversation.lastMessageType) return MEDIA_TYPE_LABELS[conversation.lastMessageType] || conversation.contactPhoneNumber;
  return conversation.contactPhoneNumber;
}

function formatMessageTime(lastMessageAt) {
  if (!lastMessageAt) return null;
  return new Date(lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function ConversationListItem({ conversation, onSelect, onQuickClose, unread, selected, divided = true }) {
  // A cidade já foi colada no nome ("Fulano - Cidade"), mas os dois dividiam um
  // `truncate` só: nome comprido comia a cidade inteira. Com cada atendente
  // puxando uma cidade diferente, era justamente o dado que sumia — então ela
  // virou um chip próprio na segunda linha, que não disputa espaço com o nome.
  const nameLabel = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const previewText = getPreviewText(conversation);
  const messageTime = formatMessageTime(conversation.lastMessageAt);

  function handleSelect() {
    onSelect(conversation.id);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect();
    }
  }

  function handleQuickClose(event) {
    event.stopPropagation();
    if (window.confirm('Encerrar esse atendimento sem motivo?')) {
      onQuickClose(conversation.id);
    }
  }

  return (
    <li className="px-0.5">
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
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
            <span className="truncate text-[16px] leading-[22px] text-chat-text">{nameLabel}</span>
            {messageTime && (
              <span className={`shrink-0 text-[12.5px] leading-[16px] ${unread ? 'font-medium text-chat-orange' : 'text-chat-faint'}`}>
                {messageTime}
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="flex min-w-0 flex-1 basis-[7rem] items-center gap-1 text-[14px] leading-[20px] text-chat-muted">
              {conversation.lastMessageDirection === 'outbound' && (
                <MessageStatusTicks status={conversation.lastMessageStatus} />
              )}
              <span className="truncate">{previewText}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {conversation.contactCityName && (
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-[1px] text-[11px] font-medium text-chat-muted">
                  {conversation.contactCityName}
                </span>
              )}
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
          {conversation.aiTriageCompletedAt && (
            <p className="mt-0.5 truncate text-[11.5px] text-chat-muted">
              Triagem IA{conversation.aiTriageReasonName ? ` · ${conversation.aiTriageReasonName}` : ''}
              {conversation.aiTriageLowConfidence && (
                <span className="ml-1 rounded bg-wa-warn-bg px-1 text-wa-warn-text">confiança baixa</span>
              )}
              {conversation.aiTriageResolvedByAi && (
                <span className="ml-1 rounded bg-wa-chip px-1 text-wa-chip-text">resolvido pela IA</span>
              )}
            </p>
          )}
        </span>
        {onQuickClose && (
          <button
            type="button"
            onClick={handleQuickClose}
            aria-label="Finalizar sem motivo"
            title="Finalizar sem motivo"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chat-orange/12 text-chat-orange transition hover:bg-chat-orange/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chat-orange"
          >
            <IconCheckCircle size={20} />
          </button>
        )}
      </div>
      {/* A conversa aberta é um cartão inteiro; as demais ficam separadas por um fio. */}
      {divided && !selected && <span aria-hidden="true" className="mx-4 block h-px bg-white/[0.07]" />}
    </li>
  );
}

export default ConversationListItem;
