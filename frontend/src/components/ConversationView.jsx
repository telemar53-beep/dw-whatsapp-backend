import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { claimConversation, closeConversation, sendSgpBoletoPdf } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import MessageStatusTicks from './MessageStatusTicks';
import ConversationHistoryModal from './ConversationHistoryModal';
import CloseReasonModal from './CloseReasonModal';
import ContactAvatar from './ContactAvatar';
import EditContactModal from './EditContactModal';
import SgpLookupPanel from './SgpLookupPanel';
import {
  IconArrowLeft,
  IconChevronDown,
  IconHistory,
  IconTransfer,
  IconCheckCircle,
  IconClaim,
  IconLock,
  IconSearch,
} from './icons/WaIcons';

const OVERLAY_TYPES = ['image', 'video', 'sticker'];
const BLOCK_TYPES = ['document', 'location'];

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(value) {
  const day = startOfDay(value);
  const today = startOfDay(Date.now());
  const oneDay = 86400000;
  if (day === today) return 'Hoje';
  if (day === today - oneDay) return 'Ontem';
  if (today - day < oneDay * 7) return new Date(value).toLocaleDateString('pt-BR', { weekday: 'long' });
  return new Date(value).toLocaleDateString('pt-BR');
}

function clockLabel(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function buildTimeline(messages) {
  const rows = [];
  let previousDay = null;
  let previousDirection = null;

  messages.forEach((message) => {
    const day = message.createdAt ? startOfDay(message.createdAt) : null;
    const dayChanged = day !== null && day !== previousDay;

    if (dayChanged) {
      rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(message.createdAt) });
      previousDirection = null;
      previousDay = day;
    }

    rows.push({
      kind: 'message',
      key: message.id,
      message,
      firstOfGroup: previousDirection !== message.direction,
    });
    previousDirection = message.direction;
  });

  return rows;
}

function HeaderIconButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-black/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-wa-green"
    >
      {children}
    </button>
  );
}

function ConversationView({ conversation, onTransferClick, onBack }) {
  const { token, agent } = useAuth();
  const { messages, sendMessage, appendMessage } = useConversationMessages(conversation.id);
  const { quickReplies } = useQuickReplies();
  const [showingHistory, setShowingHistory] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactOverride, setContactOverride] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [sgpPanelOpen, setSgpPanelOpen] = useState(false);
  const [closingReason, setClosingReason] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    setContactOverride(null);
    setEditingContact(false);
    setReplyingTo(null);
    setSgpPanelOpen(false);
    setClosingReason(false);
  }, [conversation.id]);

  useEffect(() => {
    if (bottomRef.current && bottomRef.current.scrollIntoView) {
      bottomRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages.length, conversation.id]);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isMine = conversation.assignedAgentId === agent.id;
  const displayName = contactOverride ? contactOverride.displayName : conversation.contactDisplayName;
  const cityName = contactOverride ? contactOverride.cityName : conversation.contactCityName;
  const nameLabel = displayName || conversation.contactPhoneNumber || 'Conversa';
  const headerLabel = cityName ? `${nameLabel} - ${cityName}` : nameLabel;
  const subtitle =
    displayName && conversation.contactPhoneNumber
      ? conversation.contactPhoneNumber
      : conversation.sectorName || 'clique aqui para ver os dados do contato';

  async function handleSend(content, file, repliedToMessageId, isVoiceNote) {
    await sendMessage(content, file, repliedToMessageId, isVoiceNote);
    setReplyingTo(null);
  }

  async function handleSendSgpPdf(contratoId, boletoLink) {
    const message = await sendSgpBoletoPdf(contratoId, conversation.id, boletoLink, token);
    appendMessage(message);
    return message;
  }

  async function handleClaim() {
    try {
      await claimConversation(conversation.id, token);
    } catch (err) {
      window.alert((err.body && err.body.error) || 'Não foi possível assumir este atendimento.');
    }
  }

  async function handleConfirmClose(reasonId) {
    await closeConversation(conversation.id, reasonId, token);
    setClosingReason(false);
  }

  const timeline = buildTimeline(messages);

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col bg-wa-chat font-wa">
      <div className="z-10 flex items-center gap-1 border-b border-white/60 bg-white/55 px-2 py-[7px] backdrop-blur-xl md:px-4">
        <button
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full text-wa-icon hover:bg-black/[.06] md:hidden"
          aria-label="Voltar para a lista"
        >
          <IconArrowLeft size={22} />
        </button>
        <button
          onClick={() => setEditingContact(true)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-black/[.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-wa-green"
          aria-label={`Editar cliente: ${headerLabel}`}
        >
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={displayName}
            phoneNumber={conversation.contactPhoneNumber}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] leading-[21px] text-wa-text">{headerLabel}</span>
            <span className="block truncate text-[13px] leading-[17px] text-wa-muted">{subtitle}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {isUnassigned && (
            <button
              onClick={handleClaim}
              className="mr-1 flex items-center gap-1.5 rounded-full bg-wa-green px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green-dark"
            >
              <IconClaim size={17} />
              Assumir
            </button>
          )}
          <HeaderIconButton label="Ver atendimentos anteriores" onClick={() => setShowingHistory(true)}>
            <IconHistory size={22} />
          </HeaderIconButton>
          <HeaderIconButton label="Consultar SGP" onClick={() => setSgpPanelOpen((prev) => !prev)}>
            <IconSearch size={22} />
          </HeaderIconButton>
          {(isMine || isUnassigned) && (
            <>
              <HeaderIconButton label="Transferir atendimento" onClick={() => onTransferClick(conversation.id)}>
                <IconTransfer size={22} />
              </HeaderIconButton>
              <HeaderIconButton label="Fechar atendimento" onClick={() => setClosingReason(true)}>
                <IconCheckCircle size={22} />
              </HeaderIconButton>
            </>
          )}
        </div>
      </div>

      <div className="wa-wallpaper wa-scroll flex-1 overflow-y-auto overflow-x-hidden px-[4%] py-3 lg:px-[6%]">
        <div className="mx-auto mb-3 flex w-fit max-w-[90%] items-center gap-1.5 rounded-[8px] bg-amber-signal/15 px-3 py-1.5 text-center text-[12.5px] leading-[18px] text-amber-signal-dark shadow-[0_1px_0.5px_rgba(11,20,26,.08)]">
          <span className="shrink-0 text-amber-signal-dark">
            <IconLock size={13} />
          </span>
          Este atendimento fica registrado no sistema da DW Telecom.
        </div>

        {timeline.map((row) => {
          if (row.kind === 'day') {
            return (
              <div key={row.key} className="my-3 flex justify-center">
                <span className="rounded-[7.5px] bg-white/80 px-3 py-[5px] text-[12.5px] font-medium text-wa-icon shadow-[0_1px_0.5px_rgba(11,20,26,.08)]">
                  {row.label}
                </span>
              </div>
            );
          }

          const message = row.message;
          const outbound = message.direction === 'outbound';
          const hasText = Boolean(message.content);
          const isSticker = message.messageType === 'sticker' && message.mediaPath;
          const metaMode = !hasText && OVERLAY_TYPES.includes(message.messageType) && message.mediaPath
            ? 'overlay'
            : !hasText && BLOCK_TYPES.includes(message.messageType)
              ? 'block'
              : 'float';
          const tight = metaMode === 'overlay' && !isSticker;
          const repliedToLabel = message.repliedToPreview
            ? message.repliedToPreview.direction === 'outbound'
              ? 'Você'
              : displayName || conversation.contactPhoneNumber || 'Conversa'
            : null;

          const meta = (
            <span
              className={`flex shrink-0 items-center gap-[3px] text-[11px] leading-[15px] ${
                metaMode === 'overlay' ? 'text-white' : 'text-wa-meta'
              }`}
            >
              {clockLabel(message.createdAt)}
              {outbound && <MessageStatusTicks status={message.status} />}
            </span>
          );

          return (
            <div
              key={row.key}
              className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${row.firstOfGroup ? 'mt-3' : 'mt-[2px]'}`}
            >
              <div
                className={`group relative max-w-[85%] md:max-w-[65%] ${
                  isSticker
                    ? ''
                    : `wa-bubble rounded-[7.5px] ${outbound ? 'bg-wa-out' : 'bg-wa-in'} ${
                        tight ? 'p-[3px]' : 'px-[9px] pb-[8px] pt-[6px]'
                      } ${
                        row.firstOfGroup
                          ? outbound
                            ? 'wa-tail-out rounded-tr-none'
                            : 'wa-tail-in rounded-tl-none'
                          : ''
                      }`
                }`}
              >
                {message.repliedToPreview && (
                  <div
                    className={`mb-1 flex overflow-hidden rounded-[4px] ${
                      outbound ? 'bg-black/[.07]' : 'bg-black/[.04]'
                    }`}
                  >
                    <span className="w-[4px] shrink-0 bg-wa-quote" />
                    <span className="min-w-0 flex-1 px-2 py-1">
                      <span className="block truncate text-[12.8px] font-medium leading-[18px] text-wa-quote">
                        {repliedToLabel}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-wa-muted">
                        {message.repliedToPreview.content}
                      </span>
                    </span>
                  </div>
                )}

                <MessageAttachment
                  message={message}
                  avatar={
                    !outbound ? (
                      <ContactAvatar
                        contactId={conversation.contactId}
                        avatarPath={conversation.contactAvatarPath}
                        displayName={displayName}
                        phoneNumber={conversation.contactPhoneNumber}
                        size={42}
                      />
                    ) : null
                  }
                />

                {hasText && (
                  <p className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px] text-wa-text">
                    {message.content}
                    <span
                      aria-hidden="true"
                      className="inline-block h-[1px] align-bottom"
                      style={{ width: outbound ? 74 : 52 }}
                    />
                  </p>
                )}

                {metaMode === 'float' && (
                  <span className="absolute bottom-[4px] right-[9px]">{meta}</span>
                )}
                {metaMode === 'overlay' && (
                  <span className="absolute bottom-[7px] right-[8px] rounded-full bg-black/35 px-1.5 py-[1px] backdrop-blur-[1px]">
                    {meta}
                  </span>
                )}
                {metaMode === 'block' && <span className="mt-1 flex justify-end">{meta}</span>}

                {isMine && hasText && (
                  <button
                    onClick={() => setReplyingTo(message)}
                    aria-label="Responder"
                    title="Responder"
                    className={`absolute right-0 top-0 flex h-[22px] w-[26px] items-center justify-end rounded-tr-[7.5px] pr-[3px] text-wa-icon opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                      outbound
                        ? 'bg-[linear-gradient(to_left,#dcefe9_60%,rgba(220,239,233,0))]'
                        : 'bg-[linear-gradient(to_left,#ffffff_60%,rgba(255,255,255,0))]'
                    }`}
                  >
                    <IconChevronDown size={19} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
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
      {closingReason && <CloseReasonModal onConfirm={handleConfirmClose} onClose={() => setClosingReason(false)} />}
      </div>
      {sgpPanelOpen && (
        <SgpLookupPanel
          onSendMessage={(content) => sendMessage(content)}
          onSendPdf={handleSendSgpPdf}
          onClose={() => setSgpPanelOpen(false)}
        />
      )}
    </div>
  );
}

export default ConversationView;
