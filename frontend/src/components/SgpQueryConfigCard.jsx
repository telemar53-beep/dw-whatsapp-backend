import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpQueryConfig } from '../hooks/useSgpQueryConfig';
import { updateSgpQueryConfig } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const cardClass = 'space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

function SgpQueryConfigCard() {
  const { token } = useAuth();
  const { config, refresh } = useSgpQueryConfig();
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
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-ink-950">Consulta ao SGP (cliente/boleto)</h3>
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
            <span className="text-sm text-ink-950/60">Token terminando em ...{config.tokenLast4}</span>
            <button type="button" onClick={() => setChangingToken(true)} className="text-sm font-medium text-teal-signal underline">
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
      <label className="flex items-center gap-2 text-sm text-ink-950/70">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-teal-signal" />
        Ativo
      </label>
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Salvar
      </button>
    </form>
  );
}

export default SgpQueryConfigCard;
