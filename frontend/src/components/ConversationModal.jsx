import { useEffect } from 'react';
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="animate-wa-pop relative flex h-[85vh] max-h-[880px] w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-[0_40px_100px_-30px_rgba(15,35,60,0.55)] backdrop-blur-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar conversa"
          title="Fechar"
          className="absolute right-3 top-3 z-20 hidden h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/80 text-ink-950/55 shadow-sm backdrop-blur-md transition hover:bg-white hover:text-ink-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-signal md:flex"
        >
          <IconClose size={16} />
        </button>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConversationView conversation={conversation} onTransferClick={onTransferClick} onBack={onClose} />
        </div>
        <ConversationInfoPanel conversation={conversation} />
      </div>
    </div>
  );
}

export default ConversationModal;
