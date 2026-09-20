import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { updateSgpQueryConfig } from '../services/api';
import { AsyncState } from './ui';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-[14px] border border-wa-border bg-black/[0.12] px-4 py-4 sm:px-5';

function SgpQueryConfigCard() {
  const { token } = useAuth();
  const { config, status, refresh } = useSgpQueryConfig();
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [app, setApp] = useState('');
  const [newToken, setNewToken] = useState('');
  const [changingToken, setChangingToken] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (config.configured) {
      setBaseUrl(config.baseUrl);
      setApp(config.app);
      setEnabled(config.enabled);
    }
  }, [config]);

  function handleEditClick() {
    setError(null);
    setChangingToken(false);
    setNewToken('');
    setEditing(true);
  }

  function handleCancel() {
    if (config.configured) {
      setBaseUrl(config.baseUrl);
      setApp(config.app);
      setEnabled(config.enabled);
    } else {
      setBaseUrl('');
      setApp('');
      setEnabled(true);
    }
    setChangingToken(false);
    setNewToken('');
    setError(null);
    setEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    if (!baseUrl.trim()) {
      setError('URL é obrigatória');
      return;
    }
    if (!app.trim()) {
      setError('App é obrigatório');
      return;
    }
    if (!config.configured && !newToken.trim()) {
      setError('Token é obrigatório');
      return;
    }
    setSaving(true);
    try {
      await updateSgpQueryConfig(
        {
          baseUrl: baseUrl.trim(),
          app: app.trim(),
          token: newToken.trim() || undefined,
          enabled,
        },
        token
      );
      refresh();
      setChangingToken(false);
      setNewToken('');
      setEditing(false);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <section className="rounded-[14px] border border-wa-border bg-black/[0.12] px-4 py-4 sm:px-5">
        <h3 className="text-[15px] font-semibold text-wa-text">Conexão para consultas</h3>
        <AsyncState status={status} skeletonLines={2}>
          {!config.configured ? (
            <div className="mt-3 space-y-3">
              <p className="text-[13.5px] text-wa-muted">
                O chat ainda não consulta o SGP. Informe o endereço, o app e o token para o painel da conversa e a IA
                buscarem cliente, contrato e fatura.
              </p>
              <button
                type="button"
                onClick={handleEditClick}
                className="inline-flex h-9 items-center rounded-[10px] border border-wa-border bg-wa-field px-3.5 text-[13.5px] font-medium text-wa-text transition hover:bg-wa-panel"
              >
                Criar integração
              </button>
            </div>
          ) : (
            <>
              <dl className="mt-2 divide-y divide-wa-border">
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="w-[38%] shrink-0 text-[13px] text-wa-muted">Endereço do SGP</dt>
                  <dd className="min-w-0 flex-1 truncate text-[13.5px] text-wa-text" title={config.baseUrl}>
                    {config.baseUrl}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="w-[38%] shrink-0 text-[13px] text-wa-muted">App</dt>
                  <dd className="min-w-0 flex-1 truncate text-[13.5px] text-wa-text">{config.app}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="w-[38%] shrink-0 text-[13px] text-wa-muted">Situação</dt>
                  <dd className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px] text-wa-text">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${config.enabled ? 'bg-wa-chip-text' : 'bg-wa-border-strong'}`} />
                    {config.enabled ? 'Ativa' : 'Inativa'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3 py-2.5">
                  <dt className="w-[38%] shrink-0 text-[13px] text-wa-muted">Credencial</dt>
                  <dd className="min-w-0 flex-1 text-[13.5px] text-wa-text">
                    <span className="tracking-[0.2em]">••••••••••</span>
                    {config.tokenLast4 ? <span className="tracking-normal">{config.tokenLast4}</span> : null}
                    <span className="block text-[12.5px] text-wa-muted">Configurada</span>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={handleEditClick}
                className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-wa-border bg-wa-field px-3.5 text-[13.5px] font-medium text-wa-text transition hover:bg-wa-panel"
              >
                Editar conexão
              </button>
            </>
          )}
        </AsyncState>
      </section>
    );
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="text-[15px] font-semibold text-wa-text">Conexão para consultas</h3>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.6fr)]">
      <div>
        <label htmlFor="sgp-query-base-url" className={labelClass}>URL de acesso ao SGP</label>
        <input id="sgp-query-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="sgp-query-app" className={labelClass}>App</label>
        <input id="sgp-query-app" value={app} onChange={(e) => setApp(e.target.value)} className={inputClass} />
      </div>
      </div>
      <div>
        {config.configured && !changingToken ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-wa-muted">Token terminando em ...{config.tokenLast4}</span>
            <button type="button" onClick={() => setChangingToken(true)} className="text-sm font-medium text-wa-link underline">
              Trocar token
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="sgp-query-token" className={labelClass}>Token</label>
            <input id="sgp-query-token" value={newToken} onChange={(e) => setNewToken(e.target.value)} className={inputClass} />
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-wa-muted">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-wa-green" />
        Ativo
      </label>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar consulta ao SGP
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

export default SgpQueryConfigCard;
