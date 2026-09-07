import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpIntegration } from '../hooks/useSgpIntegration';
import { useChannels } from '../hooks/useChannels';
import { saveSgpIntegration, rotateSgpIntegrationKey } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const cardClass = 'space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

function IntegrationsAdminTab() {
  const { token } = useAuth();
  const { integration, refresh } = useSgpIntegration();
  const { channels } = useChannels();
  const baileysChannels = channels.filter((channel) => channel.type === 'baileys');

  const [channelId, setChannelId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);

  useEffect(() => {
    if (integration && integration.configured) {
      setChannelId(integration.channelId);
      setEnabled(integration.enabled);
    }
  }, [integration]);

  async function handleSave(event) {
    event.preventDefault();
    if (!channelId) {
      setError('Escolha um canal');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await saveSgpIntegration({ channelId, enabled }, token);
      await refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar a integração');
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateKey() {
    setError(null);
    setRotating(true);
    try {
      const result = await rotateSgpIntegrationKey(token);
      setGeneratedKey(result.apiKey);
      await refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao gerar a chave');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className={cardClass}>
        <h3 className="font-display text-base font-semibold text-ink-950">SGP</h3>
        <p className="text-sm text-ink-950/55">Permite que o SGP dispare mensagens de WhatsApp através deste sistema.</p>
        <div>
          <label htmlFor="sgp-channel" className={labelClass}>
            Canal
          </label>
          <select id="sgp-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={inputClass}>
            <option value="">Selecione um canal</option>
            {baileysChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-teal-signal"
          />
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

      {integration && integration.configured && (
        <div className={cardClass}>
          <h3 className="font-display text-base font-semibold text-ink-950">Chave de API</h3>
          <p className="text-sm text-ink-950/55">
            {integration.hasApiKey ? 'Uma chave já foi gerada.' : 'Nenhuma chave foi gerada ainda.'}
          </p>
          <button
            onClick={handleRotateKey}
            disabled={rotating}
            className="rounded-lg bg-teal-signal px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Gerar nova chave
          </button>
          {generatedKey && (
            <div className="rounded-lg border border-amber-signal/50 bg-amber-signal/10 px-3 py-2 text-sm text-ink-950">
              <p className="font-medium">Copie agora — esta chave não será mostrada novamente:</p>
              <code className="mt-1 block break-all rounded bg-white/70 px-2 py-1">{generatedKey}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IntegrationsAdminTab;
