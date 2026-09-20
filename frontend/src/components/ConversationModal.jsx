import ConversationView from './ConversationView';
import ConversationInfoPanel from './ConversationInfoPanel';
import { Dialog } from './ui/Dialog';

// Aberta a partir de "Encerrados" e da Supervisão — quase sempre por cima de
// outro diálogo. Tinha portal, backdrop, listener de ESC e z-index próprios, e
// era exatamente por isso que um único ESC fechava a conversa E a lista que a
// abriu. Agora é um diálogo como os outros: a pilha resolve camada, ESC e foco.
function ConversationModal({ conversation, onClose, onTransferClick }) {
  return (
    <Dialog
      variant="conversation"
      orientation="row"
      size="max-w-6xl"
      ariaLabel="Conversa"
      onClose={onClose}
      dismissible
      closeLabel="Fechar conversa"
      // Não fecha por clique no fundo: há uma caixa de mensagem aqui dentro, e
      // texto digitado e não enviado é trabalho que não pode sumir por engano.
      closeOnBackdrop={false}
      className="chat-workspace"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationView conversation={conversation} onTransferClick={onTransferClick} onBack={onClose} />
      </div>
      <ConversationInfoPanel conversation={conversation} />
    </Dialog>
  );
}

export default ConversationModal;
