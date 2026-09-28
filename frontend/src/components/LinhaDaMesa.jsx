import { memo } from 'react';
import ContactAvatar from './ContactAvatar';
import MessageStatusTicks from './MessageStatusTicks';
import { useConfirm } from '../hooks/useConfirm';
import { nomeDoLocal, localMaisEspecifico } from '../utils/place';
import { estadoDaConversa, getPreviewText, formatMessageTime } from './ConversationListItem';
import { IconeEncerrar } from './icones';

// Linha da lista da mesa: duas linhas contínuas, como no WhatsApp Web — nome e
// hora; prévia e marcas. Fica fora do ConversationListItem para não viajar
// para a Supervisão, que continua com a linha compacta de lá. Prévia, hora e
// estado vêm das mesmas funções dele (inclusive a regra de nunca mostrar o
// código Pix na prévia).
//
// O contrato do que ela informa está em pages/DashboardPage.linhaCompacta.test.jsx.
// Cidade e setor saem da vista, mas ficam no nome acessível; na Espera
// (`soLocalidade`), a localidade abre a 2ª linha, porque é por ela que o
// atendente reconhece quem está na fila. O nome do responsável sai: nas três
// abas da mesa ele é o próprio atendente ou ninguém.
function LinhaDaMesa({ conversation, onSelect, onQuickClose, unread, selected, showArrivalTime = false, soLocalidade = false }) {
  const { confirm, confirmDialog } = useConfirm();
  const nameLabel = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const local = soLocalidade
    ? localMaisEspecifico(conversation.contactLocalityName, conversation.contactCityName)
    : nomeDoLocal(conversation.contactLocalityName, conversation.contactCityName);
  const localNaVista = soLocalidade ? local : null;
  const paraOLeitor = [soLocalidade ? null : local, conversation.sectorName].filter(Boolean).join(', ');
  const previewText = getPreviewText(conversation);
  // Na fila, a hora da chegada (é a ordem da lista); no Atendimento, a da
  // última mensagem.
  const messageTime = formatMessageTime(showArrivalTime ? conversation.createdAt : conversation.lastMessageAt);
  const emTriagem = conversation.triageState === 'pending';
  const triada = Boolean(conversation.aiTriageCompletedAt);

  function handleSelect() {
    onSelect(conversation.id);
  }

  // Só a linha responde por Enter e Espaço; o "Finalizar sem motivo" é irmão
  // dela e cuida das próprias teclas.
  function handleKeyDown(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect();
    }
  }

  // A confirmação espera a resposta do servidor (A4-4): falhou, o erro fica
  // nela, e ela continua aberta.
  function handleQuickClose(event) {
    event.stopPropagation();
    confirm(`O atendimento de ${nameLabel} será finalizado sem informar o motivo.`, {
      title: 'Finalizar sem motivo?',
      danger: true,
      confirmLabel: 'Finalizar',
      busyLabel: 'Finalizando…',
      erroPadrao: 'Não foi possível finalizar este atendimento. Tente de novo.',
      acao: () => onQuickClose(conversation.id),
    });
  }

  return (
    <li className={`mesa-linha-item ${onQuickClose ? 'tem-finalizar' : ''}`}>
      <div role="button" tabIndex={0} onClick={handleSelect} onKeyDown={handleKeyDown}
        aria-current={selected ? 'true' : undefined}
        data-estado={estadoDaConversa(conversation)}
        className={`mesa-linha ${selected ? 'is-selected' : ''} ${unread ? 'is-unread' : ''}`}>
        <span className="mesa-linha-foto">
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={conversation.contactDisplayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={40}
          />
        </span>
        <span className="mesa-linha-topo">
          <span className="mesa-linha-nome" title={nameLabel}>{nameLabel}</span>
          {messageTime && <span className="mesa-linha-hora" title={showArrivalTime ? 'Horário de chegada à fila' : 'Horário da última mensagem'}>{messageTime}</span>}
        </span>
        <span className="mesa-linha-base">
          {localNaVista && <span className="mesa-linha-local" title={localNaVista}>{localNaVista}</span>}
          {conversation.lastMessageDirection === 'outbound' && <MessageStatusTicks status={conversation.lastMessageStatus} />}
          <span className="mesa-linha-previa">{previewText}</span>
          {(emTriagem || triada) && (
            <span className="mesa-linha-ia">
              {emTriagem && <span>IA em triagem</span>}
              {triada && <span>IA{conversation.aiTriageReasonName ? ` · ${conversation.aiTriageReasonName}` : ''}</span>}
              {triada && conversation.aiTriageLowConfidence && <span className="mesa-linha-alerta" title="A triagem da IA ficou com confiança baixa" aria-label="Triagem com confiança baixa">⚠</span>}
              {triada && conversation.aiTriageResolvedByAi && <span>Resolvido pela IA</span>}
            </span>
          )}
          {/* Marca, não contador: o servidor não diz quantas mensagens não
              lidas existem. Um número aqui seria inventado. */}
          {unread && <span className="mesa-linha-nao-lida" title="Mensagem não lida" aria-label="Mensagem não lida" />}
        </span>
        {paraOLeitor && <span className="sr-only">{paraOLeitor}</span>}
      </div>
      {/* Irmão da linha, não filho: botão dentro de role="button" é semântica
          inválida e levaria "Finalizar sem motivo" para o nome da linha. */}
      {onQuickClose && (
        <button type="button" onClick={handleQuickClose} aria-label="Finalizar sem motivo" title="Finalizar sem motivo" className="mesa-linha-finalizar">
          <IconeEncerrar tamanho={18} />
        </button>
      )}
      {confirmDialog}
    </li>
  );
}

// Memo pelo mesmo motivo do ConversationListItem: um evento de socket não pode
// redesenhar a lista inteira (guardas/memoLista.test.jsx).
export default memo(LinhaDaMesa);
