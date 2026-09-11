import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { updateSgpQueryConfig } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

function SgpQueryConfigCard() {
  const { token } = useAuth();
  const { config, refresh } = useSgpQueryConfig();
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
        { baseUrl: baseUrl.trim(), app: app.trim(), token: newToken.trim() || undefined, enabled },
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
    if (!config.configured) {
      return (
        <div className="flex items-center justify-between rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
          <p className="font-medium text-wa-text">Consulta ao SGP (cliente/boleto)</p>
          <button
            type="button"
            onClick={handleEditClick}
            className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
          >
            Criar integração
          </button>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-wa-text">Consulta ao SGP (cliente/boleto)</p>
            <p className="text-sm text-wa-muted">
              {config.baseUrl} — {config.enabled ? 'Ativo' : 'Inativo'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleEditClick}
            className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
          >
            Editar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Consulta ao SGP (cliente/boleto)</h3>
      <div>
        <label htmlFor="sgp-query-base-url" className={labelClass}>URL de acesso ao SGP</label>
        <input id="sgp-query-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="sgp-query-app" className={labelClass}>App</label>
        <input id="sgp-query-app" value={app} onChange={(e) => setApp(e.target.value)} className={inputClass} />
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

export default SgpQueryConfigCard;
