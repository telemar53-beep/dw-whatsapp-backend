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
  IconInvoice,
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

function Card({ icon, title, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/70 bg-white/60 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/50 px-3.5 py-2.5">
        <span className="text-wa-green">{icon}</span>
        <span className="text-[14.5px] font-medium text-wa-text">{title}</span>
      </div>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[12px] leading-[16px] text-wa-muted">{label}</p>
      <p className="mt-0.5 text-[14.5px] leading-[20px] text-wa-text">{value}</p>
    </div>
  );
}

function InlineField({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[12px] text-wa-muted">{label}</span>
      {children}
    </div>
  );
}

function StatusPill({ status }) {
  const active = status === 'Ativo';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${
        active ? 'bg-teal-signal/10 text-teal-signal' : 'bg-wa-active text-wa-icon'
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-wa-badge' : 'bg-wa-border-strong'}`} />
      {status}
    </span>
  );
}

function ActionTile({ label, color, icon, onClick, busy, done, pressed }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={pressed}
      className={`flex flex-col items-center justify-start gap-1.5 rounded-[10px] border bg-white/70 px-1 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wa-green disabled:opacity-60 ${
        pressed || done ? 'border-teal-signal bg-teal-signal/10' : 'border-wa-border hover:border-wa-green/50 hover:bg-wa-hover'
      }`}
    >
      <span className="flex h-7 items-center justify-center" style={{ color: done ? '#0d9488' : color }}>
        {busy ? <IconSpinner size={22} /> : done ? <IconCheck size={24} /> : icon}
      </span>
      <span className="text-center text-[11.5px] font-medium leading-[14px] text-wa-text">{label}</span>
    </button>
  );
}

function InvoiceTable({ duplicate }) {
  const cells = [
    { label: 'Vencimento', value: formatDueDate(duplicate.dueDate) },
    { label: 'Valor', value: formatCurrency(duplicate.value) },
    { label: 'Status', value: <span className="rounded-full bg-amber-signal/15 px-2 py-[2px] text-[12px] font-medium text-amber-signal-dark">Em aberto</span> },
  ];

  return (
    <div className="mt-2 overflow-hidden rounded-[8px] border border-wa-border">
      <div className="grid grid-cols-3 divide-x divide-wa-border bg-white/40">
        {cells.map((cell) => (
          <span key={cell.label} className="px-2 py-1.5 text-center text-[11.5px] text-wa-muted">
            {cell.label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 divide-x divide-wa-border border-t border-wa-border">
        {cells.map((cell) => (
          <span
            key={cell.label}
            className="flex items-center justify-center px-2 py-2 text-center text-[13px] font-medium text-wa-text"
          >
            {cell.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function FinanceiroCard({ contractId, onSendMessage, onSendPdf, state, onGenerate }) {
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
    <Card icon={<IconInvoice size={19} />} title="Financeiro">
      {!state && (
        <button
          type="button"
          onClick={onGenerate}
          className="w-full rounded-[8px] bg-wa-green px-3 py-2 text-[14px] font-medium text-white transition-colors hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green-dark"
        >
          Consultar fatura em aberto
        </button>
      )}

      {state && state.loading && (
        <p className="flex items-center gap-2 text-[14px] text-wa-muted">
          <IconSpinner size={17} />
          Consultando o SGP...
        </p>
      )}

      {state && !state.loading && state.error && (
        <p className="rounded-[6px] bg-[#fdecea] px-3 py-2 text-[13.5px] text-[#b3261e]">
          {state.errorMessage || 'Não foi possível consultar o SGP agora.'}
        </p>
      )}

      {state && !state.loading && !state.error && state.hasOpenInvoice === false && (
        <p className="text-[14px] text-wa-muted">Nenhuma fatura em aberto para este contrato.</p>
      )}

      {duplicate && (
        <>
          <p className="text-[13px] font-medium text-wa-text">Última fatura em aberto</p>
          <InvoiceTable duplicate={duplicate} />

          <div className="mt-4 flex items-center gap-2">
            <span className="text-[12px] text-wa-muted">Enviar para o cliente</span>
            <span className="h-px flex-1 bg-wa-border" />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {duplicate.pixCode && (
              <ActionTile
                label="Cód Pix"
                color="#32bcad"
                icon={<IconPix size={24} />}
                busy={busyKey === 'pix'}
                done={feedback && feedback.key === 'pix' && feedback.kind === 'sent'}
                onClick={() => runAction('pix', 'Cód Pix', () => onSendMessage(duplicate.pixCode))}
              />
            )}
            {duplicate.barCode && (
              <ActionTile
                label="Cód Barras"
                color="#0b1220"
                icon={<IconBarcode size={24} />}
                busy={busyKey === 'barcode'}
                done={feedback && feedback.key === 'barcode' && feedback.kind === 'sent'}
                onClick={() => runAction('barcode', 'Cód Barras', () => onSendMessage(duplicate.barCode))}
              />
            )}
            {duplicate.boletoLink && (
              <ActionTile
                label="Link Fatura"
                color="#1a73e8"
                icon={<IconInvoiceLink size={24} />}
                busy={busyKey === 'link'}
                done={feedback && feedback.key === 'link' && feedback.kind === 'sent'}
                onClick={() => runAction('link', 'Link Fatura', () => onSendMessage(duplicate.boletoLink))}
              />
            )}
            {duplicate.boletoLink && (
              <ActionTile
                label="PDF Fatura"
                color="#d93025"
                icon={<IconPdfFile size={24} />}
                busy={busyKey === 'pdf'}
                done={feedback && feedback.key === 'pdf' && feedback.kind === 'sent'}
                onClick={() => runAction('pdf', 'PDF Fatura', () => onSendPdf(contractId, duplicate.boletoLink))}
              />
            )}
            {duplicate.pixCode && (
              <ActionTile
                label="QR Pix"
                color="#57626d"
                icon={<IconQrCode size={24} />}
                pressed={Boolean(qrDataUrl)}
                onClick={() => handleToggleQr(duplicate.pixCode)}
              />
            )}
          </div>

          {feedback && (
            <p
              className={`mt-2.5 flex items-center gap-1.5 text-[12.5px] ${
                feedback.kind === 'sent' ? 'text-wa-green-dark' : 'text-[#b3261e]'
              }`}
            >
              {feedback.kind === 'sent' && <IconCheck size={15} />}
              {feedback.text}
            </p>
          )}

          {qrDataUrl && (
            <figure ref={qrRef} className="mt-3 flex flex-col items-center rounded-[8px] border border-wa-border bg-white/60 p-3">
              <img src={qrDataUrl} alt="QR code do Pix" className="h-36 w-36 rounded-[4px] bg-white p-1.5" />
              <figcaption className="mt-2 text-center text-[12px] text-wa-muted">
                Mostre este código para o cliente pagar pelo app do banco.
              </figcaption>
            </figure>
          )}
        </>
      )}
    </Card>
  );
}

function SgpLookupPanel({ onSendMessage, onSendPdf, onClose }) {
  const [cpf, setCpf] = useState('');
  const [selectedContractId, setSelectedContractId] = useState(null);
  const { client, contracts, loading, error, errorMessage, search, fetchDuplicate, duplicateState } = useSgpLookup();

  useEffect(() => {
    setSelectedContractId(contracts.length > 0 ? contracts[0].id : null);
  }, [contracts]);

  function handleSubmit(event) {
    event.preventDefault();
    const digits = cpf.replace(/\D/g, '');
    if (digits) search(digits);
  }

  const selectedContract = contracts.find((contract) => String(contract.id) === String(selectedContractId)) || null;

  return (
    <aside className="fixed inset-0 z-30 flex flex-col bg-white/40 font-wa backdrop-blur-2xl md:static md:z-auto md:h-full md:w-[360px] md:shrink-0 md:border-l md:border-white/50">
      <div className="flex h-[59px] shrink-0 items-center gap-2 border-b border-white/50 bg-white/40 px-4 backdrop-blur-2xl">
        <span className="text-wa-icon">
          <IconIdCard size={21} />
        </span>
        <span className="flex-1 truncate text-[16px] leading-[21px] text-wa-text">Consultar SGP</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar consulta SGP"
            title="Fechar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-black/[.06]"
          >
            <IconClose size={19} />
          </button>
        )}
      </div>

      <div className="wa-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="CPF ou CNPJ do cliente"
            aria-label="CPF do cliente"
            inputMode="numeric"
            className="h-10 min-w-0 flex-1 rounded-[8px] border border-wa-border bg-white px-3 text-[14.5px] text-wa-text outline-none placeholder:text-wa-muted focus:border-wa-green focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-wa-green/40"
          />
          <button
            type="submit"
            aria-label="Buscar"
            title="Buscar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-wa-green text-white transition-colors hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green-dark"
          >
            <IconSearch size={19} />
          </button>
        </form>

        {loading && (
          <p className="flex items-center gap-2 px-1 text-[14px] text-wa-muted">
            <IconSpinner size={17} />
            Buscando no SGP...
          </p>
        )}
        {error === 'not_found' && (
          <p className="rounded-[8px] border border-wa-border bg-white px-3 py-2.5 text-[14px] text-wa-muted">
            Cliente não encontrado. Confira o documento e busque de novo.
          </p>
        )}
        {error === 'error' && (
          <p className="rounded-[8px] bg-[#fdecea] px-3 py-2.5 text-[13.5px] text-[#b3261e]">
            {errorMessage || 'Não foi possível consultar o SGP agora.'}
          </p>
        )}

        {!client && !loading && !error && (
          <p className="px-1 pt-2 text-[13.5px] leading-[19px] text-wa-muted">
            Busque pelo documento do cliente para ver o contrato e enviar a fatura em aberto direto na conversa.
          </p>
        )}

        {client && (
          <>
            <Card icon={<IconIdCard size={19} />} title="Cliente identificado">
              {contracts.length > 0 && (
                <div className="relative mb-3">
                  <label htmlFor="sgp-contract-select" className="sr-only">
                    Contrato
                  </label>
                  <select
                    id="sgp-contract-select"
                    value={selectedContractId || ''}
                    onChange={(e) => setSelectedContractId(e.target.value)}
                    className="h-10 w-full appearance-none rounded-[8px] border border-wa-border bg-white/60 pl-3 pr-9 text-[14.5px] text-wa-text outline-none focus:border-wa-green"
                  >
                    {contracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        Contrato {contract.id}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-wa-icon">
                    <IconChevronDown size={18} />
                  </span>
                </div>
              )}

              {selectedContract && (
                <div className="space-y-3">
                  <Field label="Titular" value={client.name} />
                  <Field label="Plano" value={selectedContract.plan} />
                  <div className="space-y-2.5 border-t border-wa-border pt-3">
                    <InlineField label="Documento">
                      <span className="truncate text-[13.5px] text-wa-text">{client.document}</span>
                    </InlineField>
                    <InlineField label="Status do contrato">
                      <StatusPill status={selectedContract.status} />
                    </InlineField>
                  </div>

                  {((selectedContract.phones && selectedContract.phones.length > 0) ||
                    (selectedContract.emails && selectedContract.emails.length > 0)) && (
                    <div className="space-y-1 border-t border-wa-border pt-3">
                      {selectedContract.phones && selectedContract.phones.length > 0 && (
                        <p className="truncate text-[13px] text-wa-muted">{selectedContract.phones.join(', ')}</p>
                      )}
                      {selectedContract.emails && selectedContract.emails.length > 0 && (
                        <p className="truncate text-[13px] text-wa-muted">{selectedContract.emails.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {selectedContract && (
              <FinanceiroCard
                key={selectedContract.id}
                contractId={selectedContract.id}
                onSendMessage={onSendMessage}
                onSendPdf={onSendPdf}
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
