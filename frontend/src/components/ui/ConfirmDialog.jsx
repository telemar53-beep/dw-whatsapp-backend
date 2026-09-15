import { useEffect, useRef } from 'react';
import WaDialog from '../WaDialog';
import { Button } from './Button';

export function ConfirmDialog({ open, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  const openerRef = useRef(null);

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
  return (
    <WaDialog onClose={onCancel} size="max-w-sm">
      <div role="alertdialog" aria-modal="true" aria-describedby="confirm-message" className="px-6 pb-4 pt-5">
        <p id="confirm-message" className="text-[15px] leading-[22px] text-wa-text">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </WaDialog>
  );
}
