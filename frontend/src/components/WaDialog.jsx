import { useEffect } from 'react';

export const waInputClass =
  'w-full rounded-[10px] bg-wa-panel-header px-3.5 py-2.5 text-[14.5px] text-wa-text outline-none transition-colors placeholder:text-wa-muted focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-wa-green/60';

export const waLabelClass = 'mb-1.5 block text-[13px] font-medium text-wa-muted';

export const waPrimaryButtonClass =
  'rounded-[24px] bg-wa-green px-6 py-2 text-[14px] font-medium text-white transition-colors hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green-dark disabled:opacity-50';

export const waGhostButtonClass =
  'rounded-[24px] px-6 py-2 text-[14px] font-medium text-wa-icon transition-colors hover:bg-wa-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green';

export const waErrorClass = 'rounded-[10px] bg-wa-error-bg px-3 py-2 text-[13.5px] text-wa-error-text';

function WaDialog({ title, description, onClose, children, size = 'max-w-md' }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--wa-overlay)] p-4 font-wa backdrop-blur-[var(--wa-overlay-blur)]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className={`animate-wa-pop flex max-h-[85vh] w-full ${size} flex-col overflow-hidden rounded-[var(--wa-dialog-radius)] border border-[var(--wa-dialog-border)] bg-wa-panel shadow-[var(--wa-dialog-shadow)] backdrop-blur-[var(--wa-dialog-blur)]`}
      >
        {title && (
          <div className="shrink-0 px-6 pb-2 pt-5">
            <h2 className="text-[19px] leading-[26px] text-wa-text">{title}</h2>
            {description && <p className="mt-1.5 text-[14px] leading-[20px] text-wa-muted">{description}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default WaDialog;
