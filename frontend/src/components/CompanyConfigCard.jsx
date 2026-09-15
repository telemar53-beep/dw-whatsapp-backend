import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import { updateCompanyConfig } from '../services/api';
import { AsyncState } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

// A textarea guarda um nome por linha; o backend recebe (e devolve) um array.
function linhasParaNomes(texto) {
  return texto
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
}

function CompanyConfigCard() {
  const { token } = useAuth();
  const { config, status, refresh } = useCompanyConfig();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [payeeNames, setPayeeNames] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setName(config.name || '');
    setPayeeNames((config.acceptedPayeeNames || []).join('\n'));
  }, [config]);

  function handleEditClick() {
    setError(null);
    setName(config.name || '');
    setPayeeNames((config.acceptedPayeeNames || []).join('\n'));
    setEditing(true);
  }

  function handleCancel() {
    setName(config.name || '');
    setPayeeNames((config.acceptedPayeeNames || []).join('\n'));
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateCompanyConfig({ name: name.trim(), acceptedPayeeNames: linhasParaNomes(payeeNames) }, token);
      refresh();
      setEditing(false);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <AsyncState status={status} skeletonLines={2}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-wa-text">Empresa</p>
              <p className="text-sm text-wa-muted">{config.name ? config.name : 'Empresa não cadastrada'}</p>
              <p className="text-sm text-wa-muted">
                Nomes aceitos no comprovante:{' '}
                {(config.acceptedPayeeNames || []).length > 0 ? config.acceptedPayeeNames.join(' · ') : 'nenhum'}
              </p>
            </div>
            {/* A aba tem vários "Editar": o rótulo acessível diz qual é este. */}
            <button
              type="button"
              onClick={handleEditClick}
              aria-label="Editar dados da empresa"
              className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
            >
              Editar
            </button>
          </div>
        </AsyncState>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Empresa</h3>
      <div>
        <label htmlFor="company-name" className={labelClass}>Nome da empresa</label>
        <input id="company-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <p className="mt-1 text-[12px] text-wa-muted">Como aparece para o cliente: na tela de login, no chat e nas mensagens da IA.</p>
      </div>
      <div>
        <label htmlFor="company-payee-names" className={labelClass}>Nomes aceitos como favorecido no comprovante</label>
        <textarea
          id="company-payee-names"
          value={payeeNames}
          onChange={(e) => setPayeeNames(e.target.value)}
          rows={4}
          className={inputClass}
        />
        <p className="mt-1 text-[12px] text-wa-muted">
          Um por linha. Escreva exatamente como aparece nos comprovantes de Pix e transferência: razão social, nome
          fantasia e o titular da conta que recebe. Sem isso, nenhum comprovante confere.
        </p>
      </div>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default CompanyConfigCard;
