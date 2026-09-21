import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { updateSgpQueryConfig } from '../services/api';
import { AsyncState, Button, Field } from './ui';
import { descreverErro } from '../utils/errorMessages';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-accent/25';
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
      setError(descreverErro(err, 'Falha ao salvar'));
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
              <Button variant="secondary" onClick={handleEditClick}>
                Criar integração
              </Button>
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
              <Button variant="secondary" className="mt-3" onClick={handleEditClick}>
                Editar conexão
              </Button>
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
      <Field id="sgp-query-base-url" label="URL de acesso ao SGP">
        <input id="sgp-query-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
      </Field>
      {/* Nome curto de aplicacao; nao precisa da linha inteira. */}
      <Field id="sgp-query-app" label="App" width="sm">
        <input id="sgp-query-app" value={app} onChange={(e) => setApp(e.target.value)} className={inputClass} />
      </Field>
      </div>
      <div>
        {config.configured && !changingToken ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-wa-muted">Token terminando em ...{config.tokenLast4}</span>
            <Button variant="secondary" size="sm" onClick={() => setChangingToken(true)}>
              Trocar token
            </Button>
          </div>
        ) : (
          <Field id="sgp-query-token" label="Token">
            <input id="sgp-query-token" value={newToken} onChange={(e) => setNewToken(e.target.value)} className={inputClass} />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-wa-muted">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-accent" />
        Ativo
      </label>
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          Salvar consulta ao SGP
        </Button>
      </div>
    </form>
  );
}

export default SgpQueryConfigCard;
