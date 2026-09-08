import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { IconSearch } from './icons/WaIcons';

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

function copyToClipboard(text) {
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

const actionButtonClass = 'rounded-lg border border-wa-border bg-white p-2 text-center text-xs font-medium text-wa-text hover:bg-wa-panel';

function FinanceiroCard({ contractId, state, onGenerate }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);

  async function handleToggleQr(pixCode) {
    if (qrDataUrl) {
      setQrDataUrl(null);
      return;
    }
    const dataUrl = await QRCode.toDataURL(pixCode);
    setQrDataUrl(dataUrl);
  }

  return (
    <div className="mt-3 rounded-lg border border-wa-border bg-white p-3">
      <h3 className="font-semibold text-wa-text">Financeiro</h3>

      {!state && (
        <button type="button" onClick={onGenerate} className="mt-2 rounded-lg bg-wa-green px-2 py-1 text-xs font-medium text-white">
          Consultar fatura em aberto
        </button>
      )}

      {state && state.loading && <p className="mt-2 text-sm text-wa-muted">Consultando...</p>}

      {state && !state.loading && state.error && (
        <p className="mt-2 text-sm text-red-600">{state.errorMessage || 'Não foi possível consultar o SGP agora.'}</p>
      )}

      {state && !state.loading && !state.error && state.hasOpenInvoice === false && (
        <p className="mt-2 text-sm text-wa-muted">Nenhuma fatura em aberto para este contrato.</p>
      )}

      {state &&
        !state.loading &&
        !state.error &&
        state.hasOpenInvoice &&
        state.duplicates &&
        state.duplicates[0] &&
        (() => {
          const duplicate = state.duplicates[0];
          return (
            <>
              <p className="mt-1 text-sm font-medium text-wa-text">Última fatura em aberto</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-wa-muted">Vencimento</p>
                  <p>{formatDueDate(duplicate.dueDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-wa-muted">Valor</p>
                  <p>{formatCurrency(duplicate.value)}</p>
                </div>
                <div>
                  <p className="text-xs text-wa-muted">Status</p>
                  <p>Em aberto</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {duplicate.pixCode && (
                  <button type="button" onClick={() => copyToClipboard(duplicate.pixCode)} className={actionButtonClass}>
                    Cód Pix
                  </button>
                )}
                {duplicate.barCode && (
                  <button type="button" onClick={() => copyToClipboard(duplicate.barCode)} className={actionButtonClass}>
                    Cód Barras
                  </button>
                )}
                {duplicate.boletoLink && (
                  <a href={duplicate.boletoLink} target="_blank" rel="noreferrer" className={actionButtonClass}>
                    Link Fatura
                  </a>
                )}
                {duplicate.pixCode && (
                  <button type="button" onClick={() => handleToggleQr(duplicate.pixCode)} className={actionButtonClass}>
                    QR Pix
                  </button>
                )}
                {duplicate.boletoLink && (
                  <a href={duplicate.boletoLink} target="_blank" rel="noreferrer" className={actionButtonClass}>
                    PDF Fatura
                  </a>
                )}
              </div>
              {qrDataUrl && <img src={qrDataUrl} alt="QR code do Pix" className="mt-3 h-32 w-32" />}
            </>
          );
        })()}
    </div>
  );
}

function SgpLookupPanel() {
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
    <aside className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-wa-panel p-3 md:static md:z-auto md:h-full md:w-80 md:shrink-0 md:border-l md:border-wa-border">
      <h2 className="mb-2 font-semibold text-wa-text">Consultar SGP</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
          placeholder="CPF do cliente"
          aria-label="CPF do cliente"
          className="flex-1 rounded-lg border border-wa-border px-2 py-1.5 text-sm"
        />
        <button type="submit" aria-label="Buscar" className="flex h-9 w-9 items-center justify-center rounded-lg bg-wa-green text-white">
          <IconSearch size={18} />
        </button>
      </form>

      {loading && <p className="mt-3 text-sm text-wa-muted">Buscando...</p>}
      {error === 'not_found' && <p className="mt-3 text-sm text-wa-muted">Cliente não encontrado.</p>}
      {error === 'error' && <p className="mt-3 text-sm text-red-600">{errorMessage || 'Não foi possível consultar o SGP agora.'}</p>}

      {client && (
        <div className="mt-3">
          {contracts.length > 0 && (
            <div>
              <label htmlFor="sgp-contract-select" className="text-xs text-wa-muted">
                Contrato
              </label>
              <select
                id="sgp-contract-select"
                value={selectedContractId || ''}
                onChange={(e) => setSelectedContractId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-wa-border bg-white px-2 py-1.5 text-sm"
              >
                {contracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    Contrato {contract.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedContract && (
            <div className="mt-2 rounded-lg border border-wa-border bg-white p-3">
              <p className="text-xs text-wa-muted">Titular</p>
              <p className="text-sm font-medium text-wa-text">{client.name}</p>

              <p className="mt-2 text-xs text-wa-muted">Plano</p>
              <p className="text-sm text-wa-text">{selectedContract.plan}</p>

              <p className="mt-2 text-xs text-wa-muted">Documento</p>
              <p className="text-sm text-wa-text">{client.document}</p>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-wa-muted">Status do contrato</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    selectedContract.status === 'Ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {selectedContract.status}
                </span>
              </div>

              {selectedContract.phones && selectedContract.phones.length > 0 && (
                <p className="mt-2 text-xs text-wa-muted">{selectedContract.phones.join(', ')}</p>
              )}
              {selectedContract.emails && selectedContract.emails.length > 0 && (
                <p className="text-xs text-wa-muted">{selectedContract.emails.join(', ')}</p>
              )}
            </div>
          )}

          {selectedContract && (
            <FinanceiroCard
              key={selectedContract.id}
              contractId={selectedContract.id}
              state={duplicateState[selectedContract.id]}
              onGenerate={() => fetchDuplicate(selectedContract.id)}
            />
          )}
        </div>
      )}
    </aside>
  );
}

export default SgpLookupPanel;
