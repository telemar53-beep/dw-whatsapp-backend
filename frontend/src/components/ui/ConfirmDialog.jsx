import { useEffect, useId, useRef } from 'react';
import WaDialog from '../WaDialog';
import { Button } from './Button';
import { IconWarning, IconInfo } from '../icons/WaIcons';

export function ConfirmDialog({ open, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const openerRef = useRef(null);
  const messageId = useId();

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [open]);

  if (!open) return null;

  // Só há dois elementos focáveis dentro do diálogo (Cancelar e Confirmar):
  // prende o Tab entre eles para o foco não escapar para trás do overlay.
  function trapTab(event) {
    if (event.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <WaDialog variant="confirm" onClose={onCancel} size="max-w-sm">
      <div role="alertdialog" aria-modal="true" aria-describedby={messageId} className="px-6 pb-4 pt-5" onKeyDown={trapTab}>
        <span className="dialog-confirm-icon" data-danger={danger} aria-hidden="true">{danger ? <IconWarning size={22} /> : <IconInfo size={22} />}</span>
        <p id={messageId} className="text-[15px] leading-[22px] text-wa-text">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </WaDialog>
  );
}
