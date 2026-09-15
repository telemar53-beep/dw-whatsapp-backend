import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { createSgpIntegration } from '../../services/api';
import { isOfficialChannelType } from '../../utils/channelTypes';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

function CreateSgpIntegrationForm({ channels, integrations, templates, onCreated, onCancel }) {
  const { token } = useAuth();
  // Each channel gets at most one SGP gateway (one for Baileys, one per official channel (Meta Cloud or 360dialog)) —
  // already-integrated channels are hidden here; edit the existing card instead of creating a duplicate.
  const eligibleChannels = channels.filter(
    (channel) =>
      (channel.type === 'baileys' || isOfficialChannelType(channel.type)) &&
      !integrations.some((integration) => integration.channelId === channel.id)
  );

  const [description, setDescription] = useState('');
  const [channelId, setChannelId] = useState('');
  const [defaultTemplateId, setDefaultTemplateId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const selectedChannel = channels.find((c) => c.id === channelId);
  const isTemplateMode = Boolean(selectedChannel && isOfficialChannelType(selectedChannel.type));

  async function handleCreate(event) {
    event.preventDefault();
    if (!description.trim()) {
      setError('Descrição é obrigatória');
      return;
    }
    if (!channelId) {
      setError('Escolha um canal');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createSgpIntegration(
        { description: description.trim(), channelId, defaultTemplateId: isTemplateMode && defaultTemplateId ? defaultTemplateId : null, enabled },
        token
      );
      setDescription('');
      setChannelId('');
      setDefaultTemplateId('');
      setEnabled(true);
      onCreated();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar a integração');
    } finally {
      setSaving(false);
    }
  }

  function handleCancelCreate() {
    setDescription('');
    setChannelId('');
    setDefaultTemplateId('');
    setEnabled(true);
    setError(null);
    onCancel();
  }

  return (
    <form onSubmit={handleCreate} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Nova integração SGP</h3>
      <div>
        <label htmlFor="sgp-description" className={labelClass}>Descrição</label>
        <input id="sgp-description" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="sgp-channel" className={labelClass}>Canal</label>
        <select id="sgp-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={inputClass}>
          <option value="">Selecione um canal</option>
          {eligibleChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </div>
      {isTemplateMode && (
        <div>
          <label htmlFor="sgp-default-template" className={labelClass}>Template padrão (opcional)</label>
          <select id="sgp-default-template" value={defaultTemplateId} onChange={(e) => setDefaultTemplateId(e.target.value)} className={inputClass}>
            <option value="">Nenhum</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </div>
      )}
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
          Cadastrar
        </button>
        <button
          type="button"
          onClick={handleCancelCreate}
          className="rounded-lg border border-wa-border bg-wa-surface px-3 py-1.5 text-sm font-medium text-wa-muted transition hover:bg-wa-panel hover:text-wa-text"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default CreateSgpIntegrationForm;
