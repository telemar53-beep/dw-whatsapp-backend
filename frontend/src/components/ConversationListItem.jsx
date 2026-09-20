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

function ConversationListItem({ conversation, onSelect, onQuickClose, unread, selected, divided = true, showArrivalTime = false, compact = false }) {
  // A cidade já foi colada no nome ("Fulano - Cidade"), mas os dois dividiam um
  // `truncate` só: nome comprido comia a cidade inteira. Com cada atendente
  // puxando uma cidade diferente, era justamente o dado que sumia — então ela
  // virou um chip próprio na segunda linha, que não disputa espaço com o nome.
  const nameLabel = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const previewText = getPreviewText(conversation);
  // Na fila, a hora que importa é a da CHEGADA: a lista é ordenada por ela, e
  // mostrar a da última mensagem fazia a fila parecer fora de ordem sem estar —
  // quem chegou às 9h e falou de novo às 12h aparecia com 12h acima de quem
  // chegou às 11h. Em "Andamento", que é ordenado por atividade recente, a hora
  // da última mensagem continua sendo a certa.
  const messageTime = formatMessageTime(showArrivalTime ? conversation.createdAt : conversation.lastMessageAt);

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

  if (compact) {
    return (
      <li className="chat-conversation-entry">
        <div role="button" tabIndex={0} onClick={handleSelect} onKeyDown={handleKeyDown}
          className={`chat-conversation-row ${selected ? 'is-selected' : ''} ${unread ? 'is-unread' : ''}`}>
          <div className="chat-conversation-summary">
            <span className="chat-conversation-name" title={nameLabel}>{nameLabel}</span>
            {unread && <span className="chat-conversation-unread" title="Mensagem não lida" aria-label="Mensagem não lida" />}
            {messageTime && <span className="chat-conversation-time" title={showArrivalTime ? 'Horário de chegada à fila' : 'Horário da última mensagem'}>{messageTime}</span>}
          </div>
          <div className="chat-conversation-preview">
            {conversation.lastMessageDirection === 'outbound' && <MessageStatusTicks status={conversation.lastMessageStatus} />}
            <span className="chat-conversation-snippet">{previewText}</span>
          </div>
          {(conversation.contactCityName || conversation.sectorName || conversation.triageState === 'pending' || conversation.aiTriageCompletedAt || conversation.assignedAgentName) && (
            <div className="chat-conversation-context">
              {conversation.contactCityName && <span>{conversation.contactCityName}</span>}
              {conversation.sectorName && <span>{conversation.sectorName}</span>}
              {conversation.triageState === 'pending' && <span className="chat-conversation-ai">IA em triagem</span>}
              {conversation.aiTriageCompletedAt && <>
                <span className="chat-conversation-ai">Triagem IA{conversation.aiTriageReasonName ? `: ${conversation.aiTriageReasonName}` : ''}</span>
                {conversation.aiTriageLowConfidence && <span className="text-wa-warn-text">Confiança baixa</span>}
                {conversation.aiTriageResolvedByAi && <span className="chat-conversation-ai">Resolvido pela IA</span>}
              </>}
              {conversation.assignedAgentName && <span>{conversation.assignedAgentName}</span>}
            </div>
          )}
          {onQuickClose && (
            <button type="button" onClick={handleQuickClose} aria-label="Finalizar sem motivo" title="Finalizar sem motivo" className="chat-conversation-close">
              <IconCheckCircle size={17} />
            </button>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className="px-0.5">
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 ${compact ? 'gap-3 rounded-[12px] border-l-[3px] px-3 py-2.5' : 'gap-4 rounded-[18px] p-4'} ${
          selected ? compact ? 'border-chat-orange bg-chat-orange/[0.10]' : 'bg-white/[0.08]' : compact ? 'border-transparent hover:bg-white/[0.05]' : 'hover:bg-white/[0.04]'
        }`}
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
          size={compact ? 42 : 52}
          dark={!compact}
        />
        <span className={`flex min-w-0 flex-1 flex-col justify-center ${compact ? 'gap-0.5' : 'gap-[3px]'}`}>
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-chat-text ${compact ? `text-[14.5px] leading-[20px] ${unread ? 'font-semibold' : 'font-medium'}` : 'text-[16px] leading-[22px]'}`}>{nameLabel}</span>
            {messageTime && (
              <span className={`shrink-0 text-[12.5px] leading-[16px] ${unread ? 'font-medium text-chat-orange' : 'text-chat-faint'}`}>
                {messageTime}
              </span>
            )}
          </span>
          <span className={`flex items-center justify-between ${compact ? 'min-w-0 gap-2' : 'flex-wrap gap-x-2 gap-y-1'}`}>
            <span className={`flex min-w-0 flex-1 items-center gap-1 text-chat-muted ${compact ? 'text-[13px] leading-[18px]' : 'basis-[7rem] text-[14px] leading-[20px]'}`}>
              {conversation.lastMessageDirection === 'outbound' && (
                <MessageStatusTicks status={conversation.lastMessageStatus} />
              )}
              <span className="truncate">{previewText}</span>
            </span>
            {compact && unread && <span title="Mensagem não lida" className="h-[9px] w-[9px] shrink-0 rounded-full bg-chat-orange" />}
            {!compact && <span className="flex shrink-0 items-center gap-1.5">
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
            </span>}
          </span>
          {compact && (conversation.contactCityName || conversation.assignedAgentName || conversation.sectorName) && (
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {[conversation.contactCityName, conversation.assignedAgentName, conversation.sectorName].filter(Boolean).map((label, index) => (
                <span key={`${label}-${index}`} title={label} className="max-w-[90px] truncate rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-[1px] text-[10px] font-medium text-chat-muted">{label}</span>
              ))}
            </span>
          )}
          {conversation.aiTriageCompletedAt && (
            <p className={`${compact ? 'truncate text-[11px] leading-4' : 'mt-0.5 truncate text-[11.5px]'} text-chat-muted`}>
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
            className={`flex shrink-0 items-center justify-center bg-chat-orange/12 text-chat-orange transition hover:bg-chat-orange/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chat-orange ${compact ? 'h-8 w-8 rounded-lg' : 'h-9 w-9 rounded-full'}`}
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
