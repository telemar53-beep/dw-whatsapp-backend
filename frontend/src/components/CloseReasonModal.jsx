import { useState } from 'react';
import WaDialog, { waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';
import { useReasons } from '../hooks/useReasons';

function CloseReasonModal({ onConfirm, onClose }) {
  const { reasons } = useReasons();
  const [reasonId, setReasonId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!reasonId) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(reasonId);
    } catch (err) {
      setError((err.body && err.body.error) || 'Não foi possível encerrar este atendimento.');
      setSubmitting(false);
    }
  }

  return (
    <WaDialog title="Motivo do contato" description="Escolha o motivo antes de encerrar o atendimento." onClose={onClose}>
      <div className="wa-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
        {reasons.length === 0 ? (
          <p className="text-[14.5px] text-wa-muted">
            Nenhum motivo de contato cadastrado ainda. Peça a um administrador para cadastrar ao menos um motivo em
            Administração → Motivos antes de encerrar este atendimento.
          </p>
        ) : (
          reasons.map((reason) => (
            <label key={reason.id} className="flex items-center gap-2 text-[14.5px] text-wa-text">
              <input
                type="radio"
                name="close-reason"
                checked={reasonId === reason.id}
                onChange={() => setReasonId(reason.id)}
                className="h-4 w-4 accent-wa-green"
              />
              {reason.name}
            </label>
          ))
        )}
        {error && <p className={waErrorClass}>{error}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
        <button type="button" onClick={onClose} className={waGhostButtonClass}>
          Cancelar
        </button>
        <button type="button" onClick={handleConfirm} disabled={!reasonId || submitting} className={waPrimaryButtonClass}>
          Confirmar encerramento
        </button>
      </div>
    </WaDialog>
  );
}

export default CloseReasonModal;
