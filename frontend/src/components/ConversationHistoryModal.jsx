import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getConversationHistory, getMessages } from '../services/api';
import MessageAttachment from './MessageAttachment';
import WaDialog, { waGhostButtonClass } from './WaDialog';
import { IconArrowLeft } from './icons/WaIcons';
import { AsyncState } from './ui';

// Quem atendeu e quem encerrou nem sempre é a mesma pessoa: o admin pode
// encerrar sem estar atribuído. Um nome só no caso comum, os dois quando
// divergem — e o motivo junto, porque no histórico de um cliente que volta ele
// costuma valer mais que a data.
function quemAtendeu(conversation) {
  const { assignedAgentName: atendeu, closedByAgentName: encerrou } = conversation;
  if (atendeu && encerrou && atendeu !== encerrou) {
    return `Atendido por ${atendeu}, encerrado por ${encerrou}`;
  }
  return atendeu || (encerrou ? `Encerrado por ${encerrou}` : null);
}

function diaDoAtendimento(createdAt) {
  if (!createdAt) return '--';
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? '--' : String(d.getDate()).padStart(2, '0');
}

function mesDoAtendimento(createdAt) {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
}

// A data completa fica na linha de apoio, junto de quem atendeu e do canal: o
// bloco da esquerda mostra so dia e mes. Nada de duracao nem hora de
// encerramento — a consulta do historico nao devolve nem uma nem outra.
function linhaDeApoio(conversation) {
  return [inicioDoAtendimento(conversation.createdAt), quemAtendeu(conversation), conversation.channelName, statusLabel(conversation.status)]
    .filter(Boolean)
    .join(' · ');
}

function statusLabel(status) {
  return ({ closed: 'Finalizado', waiting: 'Em espera', in_progress: 'Em atendimento', automation: 'Em automação' })[status] || status || null;
}

function inicioDoAtendimento(createdAt, separator = ' · ') {
  if (!createdAt) return 'Início não informado';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Início não informado';
  return `${date.toLocaleDateString('pt-BR')}${separator}${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function ConversationHistoryModal({ contactId, onClose }) {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('loading');
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setHistoryStatus('loading');
    getConversationHistory(contactId, token)
      .then((data) => {
        setHistory(data);
        setHistoryStatus('ready');
      })
      .catch((err) => {
        setHistoryStatus(err && err.status === 403 ? 'forbidden' : 'error');
      });
  }, [contactId, token]);

  function openConversation(conversation) {
    setSelected(conversation);
    getMessages(conversation.id, token)
      .then(setMessages)
      .catch(() => {});
  }

  const voltarRef = useRef(null);
  // A troca lista -> detalhe muda a tela inteira: o foco tem de acompanhar,
  // senao ele fica num botao que nao existe mais e o leitor de tela nao e
  // avisado de nada.
  useEffect(() => {
    if (selected && voltarRef.current) voltarRef.current.focus();
  }, [selected]);

  const titulo = selected
    ? `${selected.closeReasonName || 'Atendimento'} · ${inicioDoAtendimento(selected.createdAt)}`
    : 'Atendimentos anteriores';
  const descricao = selected
    ? [quemAtendeu(selected), selected.channelName].filter(Boolean).join(' · ')
    : `${history.length} ${history.length === 1 ? 'atendimento encerrado' : 'atendimentos encerrados'}`;

  return (
    <WaDialog variant="history" onClose={onClose} closeOnBackdrop title={titulo} description={descricao} size="max-w-[640px]">
      {selected ? (
        <>
          <div className="dialog-history-migalha shrink-0">
            <button ref={voltarRef} onClick={() => setSelected(null)} aria-label="Voltar para atendimentos anteriores" className="dialog-history-voltar">
              <IconArrowLeft size={16} />
              Atendimentos anteriores
            </button>
          </div>
          <dl className="dialog-history-summary">
            <div><dt>Responsável</dt><dd>{selected.assignedAgentName || 'Não informado'}</dd></div>
            <div><dt>Status</dt><dd>{statusLabel(selected.status) || 'Não informado'}</dd></div>
            {selected.closedByAgentName && selected.closedByAgentName !== selected.assignedAgentName && <div><dt>Encerrado por</dt><dd>{selected.closedByAgentName}</dd></div>}
            <div><dt>Motivo</dt><dd>{selected.closeReasonName || 'Não informado'}</dd></div>
          </dl>
          <div className="wa-wallpaper chat-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-[14px] border border-wa-border px-3 pb-2 pt-[7px] text-[14px] leading-[19px] text-wa-text ${
                    message.direction === 'outbound' ? 'bg-wa-out' : 'bg-wa-in'
                  }`}
                >
                  {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                  <MessageAttachment message={message} dark />
                  {message.createdAt && !Number.isNaN(new Date(message.createdAt).getTime()) && (
                    <time dateTime={message.createdAt} className="mt-1 block text-right text-[11px] leading-[14px] text-wa-muted">
                      {new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="dialog-history-results wa-scroll min-h-0 flex-1 overflow-y-auto">
          <AsyncState status={historyStatus} isEmpty={history.length === 0} emptyMessage="Nenhum atendimento anterior encontrado.">
            <ul className="dialog-history-list">
              {history.map((conversation) => (
                <li key={conversation.id}>
                  <button onClick={() => openConversation(conversation)} className="dialog-history-item">
                    {/* Data em bloco proprio: e o que ordena a leitura. O
                        motivo sobe para o primeiro nivel, porque num cliente
                        que volta ele vale mais que a data; a autoria e o canal
                        descem para a linha de apoio. Antes os quatro campos
                        dividiam UMA linha de 12px com `truncate`. */}
                    <span className="dialog-history-data" aria-hidden="true">
                      <b>{diaDoAtendimento(conversation.createdAt)}</b>
                      <small>{mesDoAtendimento(conversation.createdAt)}</small>
                    </span>
                    <span className="dialog-history-record">
                      <span className="dialog-history-motivo">{conversation.closeReasonName || 'Sem motivo registrado'}</span>
                      <span className="dialog-history-apoio">{linhaDeApoio(conversation)}</span>
                    </span>
                    <span className="dialog-history-go" aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </AsyncState>
        </div>
      )}
      <div className="flex shrink-0 justify-end px-4 py-3">
        <button onClick={onClose} className={waGhostButtonClass}>
          Fechar
        </button>
      </div>
    </WaDialog>
  );
}

export default ConversationHistoryModal;
