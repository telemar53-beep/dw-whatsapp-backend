import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { IconSearch, IconChevronDown } from './icons/WaIcons';
import {
  IconPix,
  IconBarcode,
  IconQrCode,
  IconPdfFile,
  IconInvoiceLink,
  IconIdCard,
  IconClose,
  IconSpinner,
  IconCheck,
} from './icons/SgpIcons';

function formatDueDate(isoDate) {
  if (!isoDate) return isoDate;
  const [year, month, day] = isoDate.split('-');
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return `R$ ${value}`;
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Um bloco de conteúdo do painel: moldura fina, sem barra de título própria —
// o painel é estreito e cada cabeçalho custava uma linha inteira.
function Block({ children }) {
  return <section className="rounded-[16px] border border-wa-border bg-wa-surface p-3">{children}</section>;
}

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 px-0.5 pt-0.5">
      <span className="text-[12px] font-medium text-wa-muted">{children}</span>
      <span className="h-px flex-1 bg-wa-border" />
    </div>
  );
}

function Chip({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-wa-active text-wa-muted',
    good: 'bg-wa-chip text-wa-chip-text',
    warn: 'bg-wa-warn-bg text-wa-warn-text',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StatusChip({ status }) {
  const active = status === 'Ativo';
  return (
    <Chip tone={active ? 'good' : 'neutral'}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-wa-chip-text' : 'bg-wa-border-strong'}`} />
      {status}
    </Chip>
  );
}

// Ação de envio: ícone e rótulo na mesma linha, em vez do ladrilho alto.
function SendAction({ label, color, icon, onClick, busy, done, pressed }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={pressed}
      className={`flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring disabled:opacity-60 ${
        pressed || done ? 'border-wa-chip-text bg-wa-chip' : 'border-wa-border bg-wa-surface hover:border-accent/50 hover:bg-wa-hover'
      }`}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: done ? 'var(--color-wa-chip-text)' : color }}
      >
        {busy ? <IconSpinner size={16} /> : done ? <IconCheck size={16} /> : icon}
      </span>
      <span className="truncate text-[12.5px] font-medium text-wa-text">{label}</span>
    </button>
  );
}

function FinanceiroSection({ contractId, onSendMessage, onSendPdf, onSendPix, onSendPixQr, onSendBarcode, state, onGenerate }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const qrRef = useRef(null);

  useEffect(() => {
    if (qrDataUrl && qrRef.current && qrRef.current.scrollIntoView) {
      qrRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [qrDataUrl]);

  async function handleToggleQr(pixCode) {
    if (qrDataUrl) {
      setQrDataUrl(null);
      return;
    }
    const dataUrl = await QRCode.toDataURL(pixCode);
    setQrDataUrl(dataUrl);
  }

  async function runAction(key, label, action) {
    setBusyKey(key);
    setFeedback(null);
    try {
      await action();
      setFeedback({ key, kind: 'sent', text: `${label} enviado para o cliente` });
    } catch (err) {
      setFeedback({ key, kind: 'error', text: 'Não foi possível enviar. Tente de novo.' });
    } finally {
      setBusyKey(null);
    }
  }

  const duplicate = state && !state.loading && !state.error && state.hasOpenInvoice && state.duplicates && state.duplicates[0];

  return (
    <>
      <SectionLabel>Financeiro</SectionLabel>

      {!state && (
        <button
          type="button"
          onClick={onGenerate}
          className="w-full rounded-[12px] bg-accent px-3 py-2.5 text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Consultar fatura em aberto
        </button>
      )}

      {state && state.loading && (
        <p className="flex items-center gap-2 px-0.5 text-[13.5px] text-wa-muted">
          <IconSpinner size={16} />
          Consultando o SGP...
        </p>
      )}

      {state && !state.loading && state.error && (
        <p className="rounded-[12px] bg-wa-error-bg px-3 py-2 text-[13px] text-wa-error-text">
          {state.errorMessage || 'Não foi possível consultar o SGP agora.'}
        </p>
      )}

      {state && !state.loading && !state.error && state.hasOpenInvoice === false && (
        <p className="px-0.5 text-[13.5px] text-wa-muted">Nenhuma fatura em aberto para este contrato.</p>
      )}

      {duplicate && (
        <>
          <Block>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display text-[20px] font-semibold leading-tight text-wa-text">
                  {formatCurrency(duplicate.value)}
                </p>
                <p className="mt-1 text-[12.5px] text-wa-muted">vence {formatDueDate(duplicate.dueDate)}</p>
              </div>
              <Chip tone="warn">Em aberto</Chip>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-wa-border pt-3">
              {duplicate.pixCode && (
                <SendAction
                  label="Cód Pix"
                  color="#2fc8b6"
                  icon={<IconPix size={16} />}
                  busy={busyKey === 'pix'}
                  done={feedback && feedback.key === 'pix' && feedback.kind === 'sent'}
                  onClick={() => runAction('pix', 'Cód Pix', () => onSendPix(contractId, duplicate))}
                />
              )}
              {duplicate.pixCode && (
                <SendAction
                  label="Enviar QR"
                  color="#2fc8b6"
                  icon={<IconQrCode size={16} />}
                  busy={busyKey === 'pixqr'}
                  done={feedback && feedback.key === 'pixqr' && feedback.kind === 'sent'}
                  onClick={() => runAction('pixqr', 'QR Pix', () => onSendPixQr(contractId, duplicate))}
                />
              )}
              {duplicate.barCode && (
                <SendAction
                  label="Cód Barras"
                  color="var(--color-wa-text)"
                  icon={<IconBarcode size={16} />}
                  busy={busyKey === 'barcode'}
                  done={feedback && feedback.key === 'barcode' && feedback.kind === 'sent'}
                  onClick={() => runAction('barcode', 'Cód Barras', () => onSendBarcode(contractId, duplicate))}
                />
              )}
              {duplicate.boletoLink && (
                <SendAction
                  label="Link Fatura"
                  color="var(--color-sgp-blue)"
                  icon={<IconInvoiceLink size={16} />}
                  busy={busyKey === 'link'}
                  done={feedback && feedback.key === 'link' && feedback.kind === 'sent'}
                  onClick={() => runAction('link', 'Link Fatura', () => onSendMessage(duplicate.boletoLink))}
                />
              )}
              {duplicate.boletoLink && (
                <SendAction
                  label="PDF Fatura"
                  color="var(--color-sgp-red)"
                  icon={<IconPdfFile size={16} />}
                  busy={busyKey === 'pdf'}
                  done={feedback && feedback.key === 'pdf' && feedback.kind === 'sent'}
                  onClick={() => runAction('pdf', 'PDF Fatura', () => onSendPdf(contractId, duplicate.boletoLink))}
                />
              )}
              {duplicate.pixCode && (
                <SendAction
                  label="Ver QR"
                  color="var(--color-sgp-gray)"
                  icon={<IconQrCode size={16} />}
                  pressed={Boolean(qrDataUrl)}
                  onClick={() => handleToggleQr(duplicate.pixCode)}
                />
              )}
            </div>

            {feedback && (
              <p
                className={`mt-2.5 flex items-center gap-1.5 text-[12px] ${
                  feedback.kind === 'sent' ? 'text-wa-chip-text' : 'text-wa-error-text'
                }`}
              >
                {feedback.kind === 'sent' && <IconCheck size={14} />}
                {feedback.text}
              </p>
            )}

            {qrDataUrl && (
              <figure ref={qrRef} className="mt-3 flex flex-col items-center border-t border-wa-border pt-3">
                <img src={qrDataUrl} alt="QR code do Pix" className="h-28 w-28 rounded-[6px] bg-white p-1.5" />
                <figcaption className="mt-2 text-center text-[11.5px] leading-[15px] text-wa-muted">
                  Prévia. Use "Enviar QR" para mandar ao cliente.
                </figcaption>
              </figure>
            )}
          </Block>
        </>
      )}
    </>
  );
}

function SgpLookupPanel({ onSendMessage, onSendPdf, onSendPix, onSendPixQr, onSendBarcode, onClose, initialCpf }) {
  const [cpf, setCpf] = useState('');
  const [selectedContractId, setSelectedContractId] = useState(null);
  const { client, contracts, loading, error, errorMessage, search, fetchDuplicate, duplicateState } = useSgpLookup();

  useEffect(() => {
    setSelectedContractId(contracts.length > 0 ? contracts[0].id : null);
  }, [contracts]);

  useEffect(() => {
    const digits = (initialCpf || '').replace(/\D/g, '');
    if (digits) {
      setCpf(digits);
      search(digits);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCpf]);

  function handleSubmit(event) {
    event.preventDefault();
    const digits = cpf.replace(/\D/g, '');
    if (digits) search(digits);
  }

  const selectedContract = contracts.find((contract) => String(contract.id) === String(selectedContractId)) || null;
  const contact = selectedContract
    ? [...(selectedContract.phones || []), ...(selectedContract.emails || [])]
    : [];

  return (
    <aside className="dialog-sgp-panel fixed inset-0 z-30 flex flex-col bg-wa-surface-soft font-wa backdrop-blur-2xl lg:static lg:z-auto lg:my-2.5 lg:mr-2.5 lg:h-auto lg:w-[300px] lg:shrink-0 lg:rounded-[20px] lg:border lg:border-wa-surface-line lg:bg-wa-surface lg:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.85)]">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-wa-surface-line px-3">
        <span className="text-wa-icon">
          <IconIdCard size={18} />
        </span>
        <span className="flex-1 truncate text-[15px] font-medium leading-[20px] text-wa-text">Consultar SGP</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar consulta SGP"
            title="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-wa-hover"
          >
            <IconClose size={17} />
          </button>
        )}
      </div>

      <div className="chat-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="CPF ou CNPJ"
            aria-label="CPF do cliente"
            inputMode="numeric"
            className="h-10 min-w-0 flex-1 rounded-[12px] border border-wa-border bg-wa-field px-3 text-[14px] text-wa-text outline-none placeholder:text-wa-muted focus:border-accent focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-accent/40"
          />
          <button
            type="submit"
            aria-label="Buscar"
            title="Buscar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-accent text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <IconSearch size={18} />
          </button>
        </form>

        {loading && (
          <p className="flex items-center gap-2 px-0.5 text-[13.5px] text-wa-muted">
            <IconSpinner size={16} />
            Buscando no SGP...
          </p>
        )}
        {error === 'not_found' && (
          <p className="rounded-[12px] border border-wa-border bg-wa-field px-3 py-2.5 text-[13.5px] leading-[19px] text-wa-muted">
            Cliente não encontrado. Confira o documento e busque de novo.
          </p>
        )}
        {error === 'error' && (
          <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13px] text-wa-error-text">
            {errorMessage || 'Não foi possível consultar o SGP agora.'}
          </p>
        )}

        {!client && !loading && !error && (
          <p className="px-0.5 pt-1 text-[13px] leading-[18px] text-wa-muted">
            Busque pelo documento para ver o contrato e enviar a fatura direto na conversa.
          </p>
        )}

        {client && (
          <>
            <Block>
              <p className="text-[14.5px] font-medium leading-[19px] text-wa-text">{client.name}</p>
              <p className="mt-0.5 text-[12.5px] text-wa-muted">{client.document}</p>

              {contracts.length > 0 && (
                <div className="relative mt-3">
                  <label htmlFor="sgp-contract-select" className="sr-only">
                    Contrato
                  </label>
                  <select
                    id="sgp-contract-select"
                    value={selectedContractId || ''}
                    onChange={(e) => setSelectedContractId(e.target.value)}
                    className="h-9 w-full appearance-none rounded-[10px] border border-wa-border bg-wa-field pl-3 pr-8 text-[13.5px] text-wa-text outline-none focus:border-accent"
                  >
                    {contracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        Contrato {contract.id}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-wa-icon">
                    <IconChevronDown size={16} />
                  </span>
                </div>
              )}

              {selectedContract && (
                <>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {selectedContract.plan && <Chip>{selectedContract.plan}</Chip>}
                    <StatusChip status={selectedContract.status} />
                  </div>

                  {contact.length > 0 && (
                    <div className="mt-2.5 space-y-0.5 border-t border-wa-border pt-2.5">
                      {contact.map((item) => (
                        <p key={item} className="truncate text-[12.5px] leading-[17px] text-wa-muted">
                          {item}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Block>

            {selectedContract && (
              <FinanceiroSection
                key={selectedContract.id}
                contractId={selectedContract.id}
                onSendMessage={onSendMessage}
                onSendPdf={onSendPdf}
                onSendPix={onSendPix}
                onSendPixQr={onSendPixQr}
                onSendBarcode={onSendBarcode}
                state={duplicateState[selectedContract.id]}
                onGenerate={() => fetchDuplicate(selectedContract.id)}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

export default SgpLookupPanel;
