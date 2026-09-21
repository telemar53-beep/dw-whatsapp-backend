import { useEffect } from 'react';
import { IconTransfer, IconClose } from './icons/WaIcons';

// Um alerta que fica para sempre na tela vira parte do cenário e deixa de ser
// alerta — por isso ele se dispensa sozinho. A contagem reinicia a cada
// transferência nova, porque a chave do efeito é a conversa.
const AUTO_DISMISS_MS = 9000;

function TransferNotice({ notice, onOpen, onDismiss }) {
  const conversationId = notice ? notice.conversationId : null;

  useEffect(() => {
    if (!conversationId) return undefined;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [conversationId, onDismiss]);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="dialog-transfer-notice pointer-events-none fixed bottom-5 left-1/2 z-[var(--z-toast)] w-[min(92vw,26rem)] -translate-x-1/2"
    >
      <div className="pointer-events-auto flex items-start gap-3 rounded-[14px] border border-white/10 bg-chat-panel px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-chat-copper">
          <IconTransfer size={19} />
        </span>
        <button
          type="button"
          onClick={() => onOpen(notice.conversationId)}
          aria-label={`Abrir o atendimento de ${notice.contactName}`}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-[14px] leading-[20px] text-chat-text">
            <strong className="font-semibold">{notice.byName}</strong> transferiu o atendimento de{' '}
            <strong className="font-semibold">{notice.contactName}</strong> para você.
          </p>
          <p className="mt-0.5 text-[12.5px] text-chat-muted">Clique para abrir</p>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="-mr-1 mt-0.5 shrink-0 rounded-[8px] p-1 text-chat-muted transition hover:bg-white/10 hover:text-chat-text"
        >
          <IconClose size={16} />
        </button>
      </div>
    </div>
  );
}

export default TransferNotice;
