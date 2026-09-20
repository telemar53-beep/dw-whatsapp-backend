import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import { useCompanyName } from '../hooks/useCompanyName';
import { claimConversation, closeConversation, sendSgpBoletoPdf, sendSgpPix, sendSgpPixQr, sendSgpBarcode, analyzeReceipt } from '../services/api';
import MessageInput from './MessageInput';
import MessageAttachment from './MessageAttachment';
import MessageStatusTicks from './MessageStatusTicks';
import { descreverFalha } from '../utils/failureReasons';
import ConversationHistoryModal from './ConversationHistoryModal';
import CloseReasonModal from './CloseReasonModal';
import ContactAvatar from './ContactAvatar';
import EditContactModal from './EditContactModal';
import SgpLookupPanel from './SgpLookupPanel';
import AiSuggestionCard from './AiSuggestionCard';
import SendTemplateModal from './SendTemplateModal';
import {
  IconArrowLeft,
  IconChevronDown,
  IconHistory,
  IconTransfer,
  IconCheckCircle,
  IconClaim,
  IconLock,
  IconSearch,
  IconInfo,
} from './icons/WaIcons';
import { estadoDaJanela, JANELA_FECHADA, JANELA_INDETERMINADA } from '../utils/serviceWindow';

const OVERLAY_TYPES = ['image', 'video', 'sticker'];
const BLOCK_TYPES = ['document', 'location', 'pix'];

// De quanto em quanto tempo o estado da janela é recalculado sozinho. Sem isto
// a conta ficava presa no `now` do primeiro render: um chat aberto desde cedo
// continuava dizendo "aberta" muito depois de a janela ter fechado, e só um F5
// corrigia.
const RECALCULO_DA_JANELA_MS = 60000;

// A recusa do canal por janela de 24 h (131047). É a única autoridade de
// verdade sobre a janela; o nosso estado é palpite ao lado dela.
const RECUSA_POR_JANELA = '(131047)';

function foiRecusadaPorJanela(messages) {
  return messages.some((message) => {
    if (!message || message.direction !== 'outbound' || message.status !== 'failed') return false;
    const motivo = message.metadata && message.metadata.motivoFalha;
    return typeof motivo === 'string' && motivo.startsWith(RECUSA_POR_JANELA);
  });
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// De que dia é esta mensagem, ou null quando não dá para saber. Duas
// armadilhas: startOfDay(new Date('lixo')) devolve NaN em vez de lançar (por
// isso Number.isNaN, e não só "valor falso"), e um createdAt nulo viraria 1970
// — uma data válida e absurda — em vez de "sem data".
function diaDaMensagem(value) {
  if (value === null || value === undefined || value === '') return null;
  const dia = startOfDay(value);
  return Number.isNaN(dia) ? null : dia;
}

function mesmoDiaDoCalendario(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(value) {
  const data = new Date(value);
  const hoje = new Date();
  if (mesmoDiaDoCalendario(data, hoje)) return 'Hoje';
  // "Ontem" é o dia ANTERIOR no calendário, não "86.400.000 ms atrás": num dia
  // de mudança de horário de verão a distância entre duas meias-noites locais é
  // de 23 h ou 25 h, e a subtração erra o dia. new Date(ano, mês, dia - 1) vira
  // o mês e o ano sozinho, então a conta funciona em 1º de janeiro também.
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (mesmoDiaDoCalendario(data, ontem)) return 'Ontem';
  // Mesma regra de antes (os últimos 7 dias do calendário, incluindo hoje),
  // só que contada em dias do calendário em vez de em milissegundos.
  const seisDiasAtras = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6).getTime();
  if (startOfDay(data) >= seisDiasAtras) return data.toLocaleDateString('pt-BR', { weekday: 'long' });
  return data.toLocaleDateString('pt-BR');
}

function clockLabel(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Uma mensagem sem data legível não pode ficar escondida sob o cabeçalho do dia
// ANTERIOR, que é o que acontecia: sem separador, a bolha aparecia num dia que
// não é o dela, em silêncio. Ela ganha um grupo próprio e visível — e a próxima
// mensagem com data válida volta ao agrupamento da data dela, sem ficar presa
// aqui dentro.
const DIA_DESCONHECIDO = 'desconhecido';

function buildTimeline(messages) {
  const rows = [];
  let previousDay = null;
  let previousDirection = null;

  messages.forEach((message) => {
    const day = diaDaMensagem(message.createdAt);
    const grupo = day === null ? DIA_DESCONHECIDO : day;
    const dayChanged = grupo !== previousDay;

    if (dayChanged) {
      rows.push({
        kind: 'day',
        // A posição entra na chave porque o mesmo dia pode voltar depois de um
        // grupo desconhecido, e dois cabeçalhos não podem dividir a mesma chave.
        key: `day-${grupo}-${rows.length}`,
        label: day === null ? 'Data desconhecida' : dayLabel(message.createdAt),
      });
      previousDirection = null;
      previousDay = grupo;
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

// Todos os tipos de canal do sistema são WhatsApp; o que distingue é o nome dado
// ao canal em Configurações. Conversa sem canal na carga (ex.: recém-criada pelo
// popup "Nova conversa") não ganha linha inventada — cai no telefone.
function channelLine(conversation) {
  return conversation.channelName ? `WhatsApp · ${conversation.channelName}` : null;
}

import { formatPhone } from '../utils/phone';

function conversationStatus(conversation) {
  if (conversation.status === 'closed') return { label: 'Encerrado', dot: 'bg-chat-faint' };
  if (conversation.assignedAgentId) return { label: 'Em atendimento', dot: 'bg-chat-online' };
  if (conversation.triageState === 'pending') return { label: 'Em automação', dot: 'bg-chat-orange' };
  return { label: 'Em espera', dot: 'bg-chat-orange' };
}

const ACTION =
  'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium leading-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';
const ACTION_GHOST = `${ACTION} border border-white/[0.14] bg-transparent text-chat-text hover:bg-white/[0.08]`;
const ACTION_PRIMARY = `${ACTION} bg-chat-orange px-3.5 text-[#271d17] shadow-[0_2px_10px_rgba(255,141,64,.16)] hover:brightness-110`;

function HeaderChip({ children, title, strong = false, className = '' }) {
  return (
    <span
      title={title || (typeof children === 'string' ? children : undefined)}
      className={`max-w-[180px] shrink-0 items-center truncate border-l border-white/[0.13] pl-2.5 text-[11.5px] leading-[16px] ${
        strong ? 'font-medium tabular-nums text-chat-muted' : 'text-chat-faint'
      } ${className}`}
    >
      {children}
    </span>
  );
}

function HeaderIconButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${ACTION} w-8 text-chat-icon hover:bg-white/[0.08] hover:text-chat-text`}
    >
      {children}
    </button>
  );
}

// Resumo da própria conversa. O SGP permanece na consulta já existente e
// substitui este painel enquanto estiver aberto; nenhum dado é presumido.
function CustomerPanel({ conversation, displayName, cityName, onClose }) {
  const rows = [
    ['Telefone', conversation.contactPhoneNumber],
    ['Cidade', cityName],
    ['Setor', conversation.sectorName],
    ['Atendente', conversation.assignedAgentName],
    ['Protocolo', conversation.protocolNumber],
  ].filter(([, value]) => Boolean(value));

  return (
    <aside className="chat-workspace-customer-panel chat-scroll" aria-label="Dados do cliente">
      <div className="chat-workspace-panel-heading">
        <span>Dados do cliente</span>
        <button type="button" onClick={onClose} aria-label="Fechar dados do cliente">×</button>
      </div>
      <div className="chat-workspace-panel-body">
        <div className="chat-workspace-customer-identity">
          <ContactAvatar contactId={conversation.contactId} avatarPath={conversation.contactAvatarPath} displayName={displayName} phoneNumber={conversation.contactPhoneNumber} size={52} dark />
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-chat-text">{displayName || conversation.contactPhoneNumber || 'Conversa'}</h2>
            <p className="mt-1 text-[12px] text-chat-muted">{conversation.status === 'closed' ? 'Encerrado' : conversation.assignedAgentId ? 'Em atendimento' : conversation.triageState === 'pending' ? 'Em automação' : 'Em espera'}</p>
          </div>
        </div>
        {conversation.contactInternalNote && (
          <section className="chat-workspace-panel-section">
            <h3>Nota interna</h3>
            <p className="whitespace-pre-wrap break-words">{conversation.contactInternalNote}</p>
          </section>
        )}
        {rows.length > 0 && (
          <section className="chat-workspace-panel-section">
            <h3>Atendimento</h3>
            <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </section>
        )}
        {conversation.aiTriageCompletedAt && (
          <section className="chat-workspace-panel-section">
            <h3>Triagem por IA</h3>
            {conversation.aiTriageReasonName && <p>Motivo: {conversation.aiTriageReasonName}</p>}
            {conversation.aiTriageSummary && <p className="mt-2 whitespace-pre-wrap break-words">{conversation.aiTriageSummary}</p>}
            {conversation.aiTriageLowConfidence && <p className="mt-2 text-wa-warn-text">Confiança baixa</p>}
            {conversation.aiTriageResolvedByAi && <p className="mt-2 text-chat-online">Resolvido pela IA</p>}
          </section>
        )}
      </div>
    </aside>
  );
}

function ConversationView({ conversation, onTransferClick, onBack, workspace = false }) {
  const { token, agent } = useAuth();
  // `status` já é o estado do atendimento neste componente; o do carregamento
  // das mensagens entra com nome próprio.
  const { messages, status: messagesStatus, reloadMessages, sendMessage, appendMessage } = useConversationMessages(conversation.id);
  // O relógio do cálculo da janela vive em estado, e não num `new Date()` solto
  // no corpo do render: assim a passagem do tempo (e o envio) conseguem
  // refazer a conta sem recarregar a página.
  const [agora, setAgora] = useState(() => new Date());
  const janela = estadoDaJanela({ channelType: conversation.channelType, messages, now: agora });
  const janelaFechada = janela === JANELA_FECHADA;
  const janelaIndeterminada = janela === JANELA_INDETERMINADA;
  const { quickReplies, status: quickRepliesStatus } = useQuickReplies();
  // O nome do provedor é configuração: o sistema roda em mais de uma empresa.
  // Pela rota pública, e não pela de admin: esta tela é do atendente comum.
  const { name: companyName } = useCompanyName();
  const isMine = conversation.assignedAgentId === agent.id && conversation.status !== 'closed';
  // Sem este guard, toda conversa aberta disparava GET /:id/ai-suggestion — mesmo
  // quando o atendente não é o dono (um 403 nos logs) e mesmo com a IA desligada.
  // Mesma condição isMine que já controla a exibição do card, mais abaixo.
  const { suggestion, send: sendSuggestion, edit: editSuggestion, discard: discardSuggestion } = useAiSuggestion(
    isMine ? conversation.id : null
  );
  const [showingHistory, setShowingHistory] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactOverride, setContactOverride] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [sgpPanelOpen, setSgpPanelOpen] = useState(false);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [customerPanelDismissed, setCustomerPanelDismissed] = useState(false);
  const [closingReason, setClosingReason] = useState(false);
  // A sugestão que o atendente escolheu editar: { id, content } enquanto o texto
  // está no campo de digitação, ou null. Enquanto ela existir, o próximo envio de
  // texto simples é atribuído a essa sugestão (rota de IA) em vez do envio comum.
  const [editedSuggestion, setEditedSuggestion] = useState(null);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const bottomRef = useRef(null);

  // A mesma análise que a triagem faz, pedida pelo atendente sobre a imagem que
  // ele escolheu. Só para quem está com a conversa: a rota também confere isso.
  function analisarComprovanteDaMensagem(messageId) {
    return analyzeReceipt(conversation.id, messageId, token);
  }

  useEffect(() => {
    setContactOverride(null);
    setEditingContact(false);
    setReplyingTo(null);
    setSgpPanelOpen(Boolean(conversation.contactSgpDocument));
    setCustomerPanelOpen(false);
    setCustomerPanelDismissed(false);
    setClosingReason(false);
    setEditedSuggestion(null);
    // ConversationView e MessageInput NÃO remontam ao trocar de conversa: sem
    // esta linha o relógio do cliente anterior continuaria valendo para o
    // próximo, e a janela dele seria julgada por um instante que não é o dele.
    setAgora(new Date());
  }, [conversation.id]);

  // O temporizador é recriado a cada conversa (mesmo motivo acima: nada aqui
  // remonta sozinho) e limpo ao desmontar — um setInterval esquecido continuaria
  // chamando setState de uma conversa que ninguém está mais vendo.
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), RECALCULO_DA_JANELA_MS);
    return () => clearInterval(relogio);
  }, [conversation.id]);

  useEffect(() => {
    if (bottomRef.current && bottomRef.current.scrollIntoView) {
      bottomRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages.length, conversation.id]);

  const isUnassigned = conversation.status !== 'closed' && !conversation.assignedAgentId;
  const isAdmin = (agent.role === 'admin' || agent.role === 'manager') && conversation.status !== 'closed';
  const displayName = contactOverride ? contactOverride.displayName : conversation.contactDisplayName;
  const cityName = contactOverride ? contactOverride.cityName : conversation.contactCityName;
  const nameLabel = displayName || conversation.contactPhoneNumber || 'Conversa';
  const headerLabel = cityName ? `${nameLabel} - ${cityName}` : nameLabel;
  // Só vale repetir o telefone embaixo quando o título é o nome do contato.
  const phoneLine = displayName && conversation.contactPhoneNumber ? conversation.contactPhoneNumber : null;
  const secondLine = channelLine(conversation) || phoneLine;
  // O telefone acompanha o status quando a 2ª linha ficou com o canal; se ele já
  // é a 2ª linha (conversa sem canal na carga), não repete.
  const statusPhone = phoneLine && secondLine !== phoneLine ? formatPhone(phoneLine) : null;
  const status = conversationStatus(conversation);

  async function handleSend(content, file, repliedToMessageId, isVoiceNote) {
    // Obrigatório, e não um detalhe: entre o render e o clique pode ter passado
    // tempo suficiente para a janela fechar. O aviso que o atendente vê ao
    // enviar tem que ser o de AGORA, nunca o `now` de quando a tela foi montada.
    // Continua sem bloquear nada — quem decide é o canal.
    setAgora(new Date());
    const pending = editedSuggestion;
    setEditedSuggestion(null);

    if (pending && file) {
      // Anexo ou áudio não passam pela rota de sugestão da IA (ela só aceita texto):
      // o rascunho foi abandonado em favor do arquivo, então descarta a sugestão
      // (melhor esforço — uma falha aqui não pode travar o envio do anexo) e segue
      // pelo caminho comum.
      try {
        await discardSuggestion(pending);
      } catch (err) {
        // ignorado de propósito: ver comentário acima
      }
    } else if (pending) {
      // Texto simples com uma sugestão pendente: marca 'edited' (ou 'sent', se o
      // atendente não mudou nada) no backend em vez de um envio comum.
      await sendSuggestion(pending, content);
      setReplyingTo(null);
      return;
    }

    await sendMessage(content, file, repliedToMessageId, isVoiceNote);
    setReplyingTo(null);
  }

  async function handleSendSgpPdf(contratoId, boletoLink) {
    const message = await sendSgpBoletoPdf(contratoId, conversation.id, boletoLink, token);
    appendMessage(message);
    return message;
  }

  async function handleSendSgpPix(contratoId, fatura) {
    const messages = await sendSgpPix(
      contratoId,
      conversation.id,
      { pixCode: fatura.pixCode, value: fatura.value, dueDate: fatura.dueDate, faturaId: fatura.id },
      token
    );
    messages.forEach((msg) => appendMessage(msg));
    return messages;
  }

  async function handleSendSgpPixQr(contratoId, fatura) {
    const messages = await sendSgpPixQr(
      contratoId,
      conversation.id,
      { pixCode: fatura.pixCode, value: fatura.value, dueDate: fatura.dueDate },
      token
    );
    messages.forEach((msg) => appendMessage(msg));
    return messages;
  }

  async function handleSendSgpBarcode(contratoId, fatura) {
    const messages = await sendSgpBarcode(
      contratoId,
      conversation.id,
      { barCode: fatura.barCode, value: fatura.value, dueDate: fatura.dueDate },
      token
    );
    messages.forEach((msg) => appendMessage(msg));
    return messages;
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

  async function handleSendSuggestion(item) {
    try {
      await sendSuggestion(item);
    } catch (err) {
      window.alert((err.body && err.body.error) || 'Não foi possível enviar a sugestão da IA.');
    }
  }

  function handleEditSuggestion(item) {
    const text = editSuggestion(item);
    setEditedSuggestion({ id: item.id, content: text });
  }

  async function handleDiscardSuggestion(item) {
    try {
      await discardSuggestion(item);
    } catch (err) {
      window.alert((err.body && err.body.error) || 'Não foi possível descartar a sugestão da IA.');
    }
  }

  const timeline = buildTimeline(messages);

  return (
    <div className={`${workspace ? 'chat-workspace-conversation' : ''} flex h-full`}>
      <div className="flex h-full min-w-0 flex-1 flex-col bg-transparent font-wa">
      <div className="chat-workspace-header @container z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-2 py-2.5 md:px-5">
        <div className="chat-workspace-header-identity flex min-w-[240px] flex-1 items-center gap-1.5">
        <button
          onClick={onBack}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-chat-icon hover:bg-white/10 ${workspace ? 'lg:hidden' : 'md:hidden'}`}
          aria-label="Voltar para a lista"
        >
          <IconArrowLeft size={22} />
        </button>
        <button
          onClick={() => setEditingContact(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
          aria-label={`Editar cliente: ${headerLabel}`}
        >
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={displayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={40}
            dark
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span title={phoneLine || nameLabel} className="truncate text-[16px] font-semibold leading-[21px] text-chat-text">{nameLabel}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.065] px-2 py-0.5 text-[11px] font-medium text-chat-muted">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-[16px] text-chat-muted">
              <span className="min-w-0 truncate">{secondLine || 'clique aqui para ver os dados do contato'}</span>
              {statusPhone && (
                <>
                  <span aria-hidden="true" className="text-chat-faint">·</span>
                  <span className="shrink-0 tabular-nums text-chat-muted">{statusPhone}</span>
                </>
              )}
            </span>
            {(conversation.protocolNumber || cityName || conversation.sectorName) && (
              <span className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden">
                {conversation.protocolNumber && (
                  <HeaderChip strong title={`Protocolo ${conversation.protocolNumber}`} className="hidden @min-[760px]:inline-flex">#{conversation.protocolNumber}</HeaderChip>
                )}
                {cityName && <HeaderChip className="hidden @min-[880px]:inline-flex">{cityName}</HeaderChip>}
                {conversation.sectorName && <HeaderChip className="hidden @min-[620px]:inline-flex">{conversation.sectorName}</HeaderChip>}
              </span>
            )}
          </span>
        </button>
        </div>
        <div className="chat-workspace-header-actions flex shrink-0 items-center gap-2">
          {!workspace && <>          <div className="flex items-center gap-0.5 rounded-[10px] border border-white/[0.09] bg-black/[0.10] p-0.5">
          <HeaderIconButton label="Ver atendimentos anteriores" onClick={() => setShowingHistory(true)}>
            <IconHistory size={20} />
          </HeaderIconButton>
          <HeaderIconButton label="Consultar SGP" onClick={() => setSgpPanelOpen((prev) => !prev)}>
            <IconSearch size={20} />
          </HeaderIconButton>
          {workspace && (
            <HeaderIconButton label="Dados do cliente" onClick={() => { setSgpPanelOpen(false); setCustomerPanelOpen(true); setCustomerPanelDismissed(false); }}>
              <IconInfo size={20} />
            </HeaderIconButton>
          )}
          </div>
          <span aria-hidden="true" className="h-6 w-px bg-white/[0.12]" />
</>}
          {isUnassigned && (
            <button onClick={handleClaim} className={ACTION_PRIMARY}>
              <IconClaim size={18} />
              Assumir
            </button>
          )}
          {(isMine || isUnassigned || isAdmin) && (
            <>
              <button
                type="button"
                onClick={() => onTransferClick(conversation.id)}
                aria-label="Transferir atendimento"
                title="Transferir atendimento"
                className={`${ACTION_GHOST} w-8 @min-[400px]:w-auto @min-[400px]:px-3`}
              >
                <IconTransfer size={18} />
                <span className="hidden @min-[400px]:inline">Transferir</span>
              </button>
              <button
                type="button"
                onClick={() => setClosingReason(true)}
                aria-label="Encerrar atendimento"
                title="Encerrar atendimento"
                className={isUnassigned ? `${ACTION_GHOST} w-8` : ACTION_PRIMARY}
              >
                <IconCheckCircle size={18} />
                {!isUnassigned && 'Encerrar'}
              </button>
            </>
          )}
        </div>
      </div>

      {workspace && <div className="chat-workspace-context">
        <span className="chat-workspace-context-label">{conversation.sectorName || secondLine || status.label}</span>
        <div className="chat-workspace-context-actions">
          <div className="flex items-center gap-0.5 rounded-[10px] border border-white/[0.09] bg-black/[0.10] p-0.5">
          <HeaderIconButton label="Ver atendimentos anteriores" onClick={() => setShowingHistory(true)}>
            <IconHistory size={20} />
          </HeaderIconButton>
          <HeaderIconButton label="Consultar SGP" onClick={() => setSgpPanelOpen((prev) => !prev)}>
            <IconSearch size={20} />
          </HeaderIconButton>
          {workspace && (
            <HeaderIconButton label="Dados do cliente" onClick={() => { setSgpPanelOpen(false); setCustomerPanelOpen(true); setCustomerPanelDismissed(false); }}>
              <IconInfo size={20} />
            </HeaderIconButton>
          )}
          </div>
        </div>
      </div>}

      <div className="chat-workspace-timeline chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 md:px-8">
        <div className="chat-workspace-system-note mx-auto mb-3 flex w-fit max-w-[90%] items-center gap-1.5 rounded-full bg-white/[0.13] px-4 py-2 text-center text-[13px] leading-[18px] text-chat-muted">
          <span className="shrink-0 text-chat-faint">
            <IconLock size={13} />
          </span>
          Este atendimento fica registrado no sistema da {companyName || 'empresa'}.
        </div>

        {/* Sem isto, histórico que falhou ao carregar era indistinguível de
            conversa sem mensagem nenhuma. */}
        {messagesStatus === 'error' && (
          <div
            role="alert"
            className="mx-auto mb-3 flex w-fit max-w-[90%] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[12px] border border-wa-error-text/30 bg-wa-error-bg px-4 py-2 text-center text-[13px] leading-[18px] text-wa-error-text"
          >
            <span>Não foi possível carregar as mensagens deste atendimento.</span>
            <button
              type="button"
              onClick={reloadMessages}
              className="rounded-[8px] border border-wa-error-text/40 px-2.5 py-1 text-[12.5px] font-medium transition hover:bg-wa-error-text/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {messagesStatus === 'loading' && messages.length === 0 && (
          <p role="status" className="mb-3 text-center text-[13px] leading-[18px] text-chat-faint">
            Carregando mensagens…
          </p>
        )}

        {timeline.map((row) => {
          if (row.kind === 'day') {
            return (
              <div key={row.key} className="my-3 flex justify-center">
                <span className="chat-workspace-day rounded-full bg-white/[0.13] px-4 py-2 text-[13px] font-medium text-chat-muted">
                  {row.label}
                </span>
              </div>
            );
          }

          const message = row.message;
          const outbound = message.direction === 'outbound';
          // O código Pix vive em message.content, mas nunca pode aparecer como texto solto:
          // o cartão nativo (PixCardMessage) é quem mostra a prévia truncada dele.
          const hasText = message.messageType === 'pix' ? false : Boolean(message.content);
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
              className={`flex shrink-0 items-center gap-[3px] text-[12px] leading-[16px] ${
                metaMode === 'overlay' ? 'text-white' : 'text-chat-faint'
              }`}
            >
              {outbound && message.sentBy === 'ai' && (
                <span className={`mr-1 rounded px-1 text-[10px] uppercase tracking-wide ${workspace ? 'bg-[#ffd0a8] font-bold text-[#422719]' : 'bg-white/20'}`}>IA</span>
              )}
              {clockLabel(message.createdAt)}
              {outbound && <MessageStatusTicks status={message.status} />}
            </span>
          );

          return (
            <div
              key={row.key}
              className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${row.firstOfGroup ? 'mt-3' : 'mt-[6px]'}`}
            >
              <div
                className={`chat-workspace-bubble ${outbound ? 'is-outbound' : 'is-inbound'} ${isSticker ? 'is-sticker' : ''} ${outbound && message.sentBy === 'ai' ? 'is-ai' : ''} group relative max-w-[85%] md:max-w-[65%] ${
                  isSticker
                    ? ''
                    : `rounded-[16px] border border-white/[0.14] ${outbound ? 'bg-white/[0.12]' : 'bg-white/[0.14]'} ${
                        tight ? 'p-[3px]' : 'px-3 pb-2 pt-[8px]'
                      }`
                }`}
              >
                {workspace && outbound && !isSticker && row.firstOfGroup && (
                  <span className={`chat-message-author ${message.sentBy === 'ai' ? 'is-ai' : ''}`}>
                    {message.sentBy === 'ai' ? 'Assistente IA' : 'Atendente'}
                  </span>
                )}
                {message.repliedToPreview && (
                  <div className="mb-1 flex overflow-hidden rounded-[10px] bg-black/20">
                    <span className="w-[4px] shrink-0 bg-chat-copper" />
                    <span className="min-w-0 flex-1 px-2 py-1">
                      <span className="block truncate text-[12.8px] font-medium leading-[18px] text-chat-copper">
                        {repliedToLabel}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-chat-muted">
                        {message.repliedToPreview.content || 'Mídia'}
                      </span>
                    </span>
                  </div>
                )}

                <MessageAttachment
                  message={message}
                  dark
                  onAnalyzeReceipt={isMine ? analisarComprovanteDaMensagem : undefined}
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
                  <p className="chat-workspace-message-text whitespace-pre-wrap break-words text-[15.5px] leading-[21px] text-chat-text">
                    {message.content}
                    <span
                      aria-hidden="true"
                      className="inline-block h-[1px] align-bottom"
                      style={{ width: outbound ? 82 : 58 }}
                    />
                  </p>
                )}

                {outbound && message.status === 'failed' && (
                  <p className="mt-1 text-[12px] leading-[16px] text-red-400">
                    {message.metadata?.motivoFalha
                      ? `Não entregue: ${descreverFalha(message.metadata.motivoFalha)}`
                      : 'Não entregue'}
                  </p>
                )}

                {metaMode === 'float' && (
                  <span className="absolute bottom-[5px] right-[11px]">{meta}</span>
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
                    className="absolute right-0 top-0 flex h-[22px] w-[26px] items-center justify-end rounded-tr-[18px] bg-[linear-gradient(to_left,rgba(255,255,255,0.14)_50%,rgba(255,255,255,0))] pr-[3px] text-chat-icon opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
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
        <>
          <AiSuggestionCard
            suggestion={suggestion}
            onSend={handleSendSuggestion}
            onEdit={handleEditSuggestion}
            onDiscard={handleDiscardSuggestion}
          />
          {/* Avisa, mas não bloqueia: o nosso relógio pode divergir do da Meta
              por alguns minutos, e impedir um envio que passaria seria pior do
              que deixar tentar. */}
          {janelaFechada && (
            <p className="mx-3 mb-1 flex items-start gap-2 rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] leading-[18px] text-chat-muted md:mx-5">
              <span aria-hidden="true" className="shrink-0 text-chat-copper">
                <IconInfo size={16} />
              </span>
              <span>
                <strong className="font-semibold text-chat-text">Janela de 24h fechada.</strong> O WhatsApp só entrega
                texto livre até 24h depois da última mensagem do cliente — e template não reabre essa contagem, só a
                resposta dele. Enviar agora provavelmente vai falhar; use um template aprovado.
                <button
                  type="button"
                  onClick={() => setSendingTemplate(true)}
                  className="ml-1 font-semibold text-chat-orange underline underline-offset-2 hover:brightness-110"
                >
                  Enviar template
                </button>
              </span>
            </p>
          )}
          {/* Indeterminado: não bloqueia, não promete que está aberta e não
              anuncia fechada. Diz só o que se sabe — que não deu para conferir.
              O caminho do template aparece quando o canal já recusou por janela
              de 24 h: aí a dúvida acabou, e a recusa é dele, não nossa. */}
          {janelaIndeterminada && (
            <p className="mx-3 mb-1 flex items-start gap-2 rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] leading-[18px] text-chat-muted md:mx-5">
              <span aria-hidden="true" className="shrink-0 text-chat-copper">
                <IconInfo size={16} />
              </span>
              <span>
                <strong className="font-semibold text-chat-text">Não foi possível conferir a janela de 24h.</strong> A
                hora da última mensagem do cliente veio ilegível, então não dá para dizer se a janela está aberta ou
                fechada. Você pode enviar normalmente — quem decide é o WhatsApp.
                {foiRecusadaPorJanela(messages) && (
                  <>
                    {' '}
                    Uma mensagem já foi recusada por estar fora da janela:
                    <button
                      type="button"
                      onClick={() => setSendingTemplate(true)}
                      className="ml-1 font-semibold text-chat-orange underline underline-offset-2 hover:brightness-110"
                    >
                      Enviar template
                    </button>
                  </>
                )}
              </span>
            </p>
          )}
          <MessageInput
            conversationId={conversation.id}
            onSend={handleSend}
            quickReplies={quickReplies}
            quickRepliesStatus={quickRepliesStatus}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            draftContent={editedSuggestion ? editedSuggestion.content : undefined}
            draftKey={editedSuggestion ? editedSuggestion.id : undefined}
          />
        </>
      )}
      {sendingTemplate && (
        <SendTemplateModal
          conversationId={conversation.id}
          channelId={conversation.channelId}
          onClose={() => setSendingTemplate(false)}
          onSent={() => setSendingTemplate(false)}
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
      {closingReason && (
        <CloseReasonModal
          onConfirm={handleConfirmClose}
          onClose={() => setClosingReason(false)}
          suggestedReasonId={conversation.suggestedReasonId}
        />
      )}
      </div>
      {sgpPanelOpen ? (
        <SgpLookupPanel
          onSendMessage={(content) => sendMessage(content)}
          onSendPdf={handleSendSgpPdf}
          onSendPix={handleSendSgpPix}
          onSendPixQr={handleSendSgpPixQr}
          onSendBarcode={handleSendSgpBarcode}
          onClose={() => setSgpPanelOpen(false)}
          initialCpf={conversation.contactSgpDocument || ''}
        />
      ) : workspace ? (
        <div className={`chat-workspace-customer ${customerPanelOpen ? 'is-open' : ''} ${customerPanelDismissed ? 'is-dismissed' : ''}`}>
          <CustomerPanel conversation={conversation} displayName={displayName} cityName={cityName} onClose={() => { setCustomerPanelOpen(false); setCustomerPanelDismissed(true); }} />
        </div>
      ) : null}
    </div>
  );
}

export default ConversationView;
