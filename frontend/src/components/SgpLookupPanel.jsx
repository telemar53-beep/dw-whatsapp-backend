import { useState } from 'react';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { IconSearch } from './icons/WaIcons';

function DuplicateResult({ state }) {
  if (!state) return null;
  if (state.loading) return <p className="mt-2 text-sm text-wa-muted">Gerando 2ª via...</p>;
  if (state.error) return <p className="mt-2 text-sm text-red-600">Não foi possível gerar a 2ª via agora.</p>;
  if (state.hasOpenInvoice === false) {
    return <p className="mt-2 text-sm text-wa-muted">Nenhuma fatura em aberto para este contrato.</p>;
  }
  if (!state.duplicates) return null;
  return (
    <div className="mt-2 space-y-2">
      {state.duplicates.map((duplicate) => (
        <div key={duplicate.id} className="rounded-lg border border-wa-border bg-white p-2 text-sm">
          <p>Vencimento: {duplicate.dueDate}</p>
          <p>Valor: R$ {duplicate.value}</p>
          {duplicate.barCode && (
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate">{duplicate.barCode}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(duplicate.barCode)} className="text-teal-signal underline">
                Copiar
              </button>
            </div>
          )}
          {duplicate.pixCode && (
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate">{duplicate.pixCode}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(duplicate.pixCode)} className="text-teal-signal underline">
                Copiar PIX
              </button>
            </div>
          )}
          {duplicate.boletoLink && (
            <a href={duplicate.boletoLink} target="_blank" rel="noreferrer" className="mt-1 block text-teal-signal underline">
              Abrir boleto
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function SgpLookupPanel() {
  const [cpf, setCpf] = useState('');
  const { client, contracts, loading, error, search, fetchDuplicate, duplicateState } = useSgpLookup();

  function handleSubmit(event) {
    event.preventDefault();
    const digits = cpf.replace(/\D/g, '');
    if (digits) search(digits);
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-wa-border bg-wa-panel p-3">
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
      {error === 'error' && <p className="mt-3 text-sm text-red-600">Não foi possível consultar o SGP agora.</p>}

      {client && (
        <div className="mt-3">
          <p className="font-medium text-wa-text">{client.name}</p>
          <p className="text-sm text-wa-muted">{client.document}</p>
          <div className="mt-2 space-y-2">
            {contracts.map((contract) => (
              <div key={contract.id} className="rounded-lg border border-wa-border bg-white p-2">
                <p className="text-sm font-medium">
                  {contract.plan} — {contract.status}
                </p>
                <p className="text-xs text-wa-muted">{contract.address}</p>
                <button
                  type="button"
                  onClick={() => fetchDuplicate(contract.id)}
                  className="mt-2 rounded-lg bg-wa-green px-2 py-1 text-xs font-medium text-white"
                >
                  Gerar 2ª via + PIX
                </button>
                <DuplicateResult state={duplicateState[contract.id]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

export default SgpLookupPanel;
