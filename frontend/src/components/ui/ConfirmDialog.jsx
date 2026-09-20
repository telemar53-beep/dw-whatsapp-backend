import { useId } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { IconWarning, IconInfo } from '../icons/WaIcons';

// A API externa não mudou: `useConfirm` e os sete arquivos que o usam seguem
// iguais. O que mudou é por dentro — antes isto era um `role="alertdialog"`
// dentro de um `role="dialog"`, com `aria-modal` duplicado e um trap de Tab
// artesanal que só funcionava porque havia exatamente dois botões.
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, onConfirm, onCancel }) {
  const messageId = useId();

  if (!open) return null;

  return (
    <Dialog
      role="alertdialog"
      variant="confirm"
      size="max-w-sm"
      title={title}
      ariaLabel={title ? undefined : message}
      describedBy={messageId}
      // Sem "x": Cancelar ja e a saida explicita, e dois jeitos de dizer nao
      // lado a lado so criam duvida sobre a diferenca entre eles.
      dismissible={false}
      onClose={onCancel}
      // Confirmação não fecha por clique no fundo: é decisão, não leitura.
      closeOnBackdrop={false}
    >
      <div className="dialog-confirm-body px-6 pb-4 pt-5">
        <span className="dialog-confirm-icon" data-danger={danger} aria-hidden="true">{danger ? <IconWarning size={22} /> : <IconInfo size={22} />}</span>
        <p id={messageId} className="text-[15px] leading-[22px] text-wa-text">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          {/* O foco inicial é a saída segura, nunca a ação destrutiva. */}
          <Button data-autofocus="" variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Dialog>
  );
}
