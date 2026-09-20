import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import ConversationView from './ConversationView';
import ConversationInfoPanel from './ConversationInfoPanel';
import { IconClose } from './icons/WaIcons';

function ConversationModal({ conversation, onClose, onTransferClick }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Quem abre este modal a partir de "Encerrados" é um WaDialog, que vive num
  // portal no fim do <body>. Renderizado na árvore do #root — cujo contêiner é
  // um contexto de empilhamento z-10 — esta conversa ficava ATRÁS do diálogo
  // que a abriu: clicar num atendimento encerrado parecia não fazer nada.
  // Portal no body (com `chat-theme`, que não é herdado fora do #root) e uma
  // camada acima resolvem, sem mexer no WaDialog.
  return createPortal(
    <div
      className="chat-theme fixed inset-0 z-[60] flex items-center justify-center bg-[var(--wa-overlay)] p-4 backdrop-blur-[var(--wa-overlay-blur)] sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="dialog-conversation chat-workspace animate-wa-pop relative flex h-[85vh] max-h-[880px] w-full max-w-6xl overflow-hidden rounded-[22px] border border-wa-surface-line bg-wa-panel shadow-[0_40px_100px_-30px_rgba(0,0,0,0.55)] backdrop-blur-md"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar conversa"
          title="Fechar"
          className="absolute right-3 top-3 z-20 hidden h-8 w-8 items-center justify-center rounded-full border border-wa-surface-line bg-wa-panel text-wa-muted shadow-sm backdrop-blur-md transition hover:bg-wa-hover hover:text-wa-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green md:flex"
        >
          <IconClose size={16} />
        </button>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConversationView conversation={conversation} onTransferClick={onTransferClick} onBack={onClose} />
        </div>
        <ConversationInfoPanel conversation={conversation} />
      </div>
    </div>,
    document.body,
  );
}

export default ConversationModal;
