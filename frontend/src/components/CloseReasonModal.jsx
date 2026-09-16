import { useId, useState } from 'react';
import WaDialog, { waErrorClass } from './WaDialog';
import { useReasons } from '../hooks/useReasons';
import { AsyncState } from './ui';
import { describeReason, closeReasonHeaderIcon, checkCircleIcon, closeIcon } from './closeReasonCatalog';

function ReasonCard({ reason, checked, onSelect, groupName }) {
  const id = useId();
  const look = describeReason(reason.name);
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-4 rounded-[14px] border bg-wa-panel-header px-4 py-4 transition-colors ${
        checked ? 'border-wa-green' : 'border-wa-border hover:border-wa-border-strong'
      }`}
    >
      <span
        aria-hidden="true"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px]"
        style={{ color: look.color, background: look.background }}
      >
        {look.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-name`} className="block text-[17px] font-semibold leading-[22px] text-wa-text">
          {reason.name}
        </span>
        {look.hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-[14px] leading-[18px] text-wa-muted">
            {look.hint}
          </span>
        )}
      </span>
      <input
        id={id}
        type="radio"
        name={groupName}
        value={reason.id}
        checked={checked}
        onChange={onSelect}
        aria-labelledby={`${id}-name`}
        aria-describedby={look.hint ? `${id}-hint` : undefined}
        className="h-[22px] w-[22px] shrink-0 cursor-pointer appearance-none rounded-full border-2 border-wa-border-strong transition-colors checked:border-[6px] checked:border-wa-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
      />
    </label>
  );
}

function CloseReasonModal({ onConfirm, onClose, suggestedReasonId }) {
  const { reasons, status } = useReasons();
  // Pré-seleciona o motivo que a IA classificou, mas o atendente pode trocar:
  // a escolha final continua sendo dele. O modal é montado do zero a cada
  // "Fechar", então o valor inicial já nasce certo, sem precisar de efeito.
  const [reasonId, setReasonId] = useState(suggestedReasonId || null);
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
    <WaDialog onClose={onClose} size="max-w-[1080px]">
      <div className="flex shrink-0 items-start gap-4 px-8 pb-5 pt-7">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-wa-green">
          {closeReasonHeaderIcon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[28px] font-semibold leading-[34px] text-wa-text">Motivo do contato</h2>
          <p className="mt-2 text-[18px] leading-[24px] text-wa-muted">Selecione o motivo principal deste atendimento.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          title="Fechar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-wa-border bg-wa-panel-header text-wa-icon transition-colors hover:text-wa-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
        >
          {closeIcon}
        </button>
      </div>

      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-8 pb-6">
        <AsyncState
          status={status}
          isEmpty={reasons.length === 0}
          emptyMessage="Nenhum motivo de contato cadastrado ainda. Peça a um administrador para cadastrar ao menos um motivo em Configurações → Motivos antes de encerrar este atendimento."
        >
          <div role="radiogroup" aria-label="Motivo do contato" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {reasons.map((reason) => (
              <ReasonCard
                key={reason.id}
                reason={reason}
                groupName="close-reason"
                checked={reasonId === reason.id}
                onSelect={() => setReasonId(reason.id)}
              />
            ))}
          </div>
        </AsyncState>
        {error && <p className={`${waErrorClass} mt-4`}>{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-4 border-t border-wa-border px-8 py-6">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[14px] border border-wa-border-strong bg-wa-panel-header px-9 py-3.5 text-[18px] font-medium text-wa-text transition-colors hover:bg-wa-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!reasonId || submitting}
          className="flex items-center gap-3 rounded-[14px] bg-wa-green px-7 py-3.5 text-[18px] font-semibold text-white transition-colors hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green-dark disabled:opacity-50"
        >
          <span aria-hidden="true">{checkCircleIcon}</span>
          Encerrar atendimento
        </button>
      </div>
    </WaDialog>
  );
}

export default CloseReasonModal;
