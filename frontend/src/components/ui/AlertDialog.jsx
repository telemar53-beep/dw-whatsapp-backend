import { useId } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { IconWarning } from '../icons/WaIcons';

// Substitui o `window.alert`. A semântica é a mesma de propósito: é modal e
// exige reconhecimento explícito. Um banner ou um toast seria mais discreto —
// e é justamente por isso que não serve aqui: "não foi possível assumir este
// atendimento" é coisa que o atendente precisa ter visto, não ter passado.
export function AlertDialog({ open, title = 'Aviso', message, confirmLabel = 'Entendi', onClose }) {
  const messageId = useId();

  if (!open) return null;

  return (
    <Dialog
      role="alertdialog"
      variant="alert"
      size="max-w-sm"
      title={title}
      describedBy={messageId}
      onClose={onClose}
      // Não fecha por clique no fundo nem tem "x": a saída é reconhecer.
      dismissible={false}
      closeOnBackdrop={false}
    >
      <div className="dialog-confirm-body px-6 pb-4 pt-5">
        <span className="dialog-confirm-icon" data-danger="true" aria-hidden="true"><IconWarning size={22} /></span>
        <p id={messageId} className="text-[15px] leading-[22px] text-wa-text">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button data-autofocus="" onClick={onClose}>{confirmLabel}</Button>
        </div>
      </div>
    </Dialog>
  );
}
