import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createChannel } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 placeholder-ink-950/35 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';

function CreateChannelForm({ type, onCreated, onCancel }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload =
      type === 'meta_cloud'
        ? { type, name, phoneNumber, phoneNumberId, accessToken, wabaId }
        : type === '360dialog'
          ? { type, name, phoneNumber, apiKey, wabaId }
          : { type, name, phoneNumber };
    try {
      await createChannel(payload, token);
      setName('');
      setPhoneNumber('');
      setPhoneNumberId('');
      setAccessToken('');
      setWabaId('');
      setApiKey('');
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar canal');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="name" className={labelClass}>
          Nome
        </label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>
      <div>
        <label htmlFor="phoneNumber" className={labelClass}>
          Telefone
        </label>
        <input
          id="phoneNumber"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+5511999998888"
          className={inputClass}
          required
        />
      </div>
      {type === 'meta_cloud' && (
        <>
          <div>
            <label htmlFor="phoneNumberId" className={labelClass}>
              Phone Number ID
            </label>
            <input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="accessToken" className={labelClass}>
              Access Token
            </label>
            <input
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="wabaId" className={labelClass}>
              WABA ID
            </label>
            <input id="wabaId" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={inputClass} required />
          </div>
        </>
      )}
      {type === '360dialog' && (
        <>
          <div>
            <label htmlFor="apiKey" className={labelClass}>
              API Key (D360-API-KEY)
            </label>
            <input id="apiKey" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label htmlFor="wabaId360" className={labelClass}>
              WABA ID
            </label>
            <input id="wabaId360" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={inputClass} required />
          </div>
        </>
      )}
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cadastrar
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default CreateChannelForm;
