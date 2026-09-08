import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSgpIntegrations } from '../hooks/useSgpIntegrations';
import { useChannels } from '../hooks/useChannels';
import { useTemplates } from '../hooks/useTemplates';
import { createSgpIntegration, updateSgpIntegration, rotateSgpIntegrationKey } from '../services/api';
import SgpQueryConfigCard from './SgpQueryConfigCard';

const inputClass =
  'w-full rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2.5 text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink-950/70';
const cardClass = 'space-y-3 rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

const MODE_LABELS = { freetext: 'Texto livre (Baileys)', template: 'Template (oficial)' };

function IntegrationCard({ integration, channels, templates, onChanged }) {
  const { token } = useAuth();
  const [rotating, setRotating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editDescription, setEditDescription] = useState(integration.description);
  const [editChannelId, setEditChannelId] = useState(integration.channelId);
  const [editDefaultTemplateId, setEditDefaultTemplateId] = useState(integration.defaultTemplateId || '');
  const channel = channels.find((c) => c.id === integration.channelId);
  // Unlike the create form, the edit form must keep this card's own channel selectable —
  // so it filters by type only, without excluding already-integrated channels.
  const editableChannels = channels.filter((c) => c.type === 'baileys' || c.type === 'meta_cloud');
  const editSelectedChannel = channels.find((c) => c.id === editChannelId);
  const editIsTemplateMode = Boolean(editSelectedChannel && editSelectedChannel.type === 'meta_cloud');

  function seedEditState() {
    setEditDescription(integration.description);
    setEditChannelId(integration.channelId);
    setEditDefaultTemplateId(integration.defaultTemplateId || '');
  }

  function handleStartEdit() {
    setError(null);
    seedEditState();
    setEditing(true);
  }

  function handleCancelEdit() {
    seedEditState();
    setError(null);
    setEditing(false);
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    setError(null);
    setSavingEdit(true);
    try {
      await updateSgpIntegration(
        integration.id,
        {
          description: editDescription.trim(),
          channelId: editChannelId,
          defaultTemplateId: editIsTemplateMode && editDefaultTemplateId ? editDefaultTemplateId : null,
          // Editing must never flip Ativo as a side effect — the toggle is the only control for that.
          enabled: integration.enabled,
        },
        token
      );
      onChanged();
      setEditing(false);
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao atualizar');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleEnabled(event) {
    setError(null);
    try {
      await updateSgpIntegration(
        integration.id,
        { description: integration.description, channelId: integration.channelId, defaultTemplateId: integration.defaultTemplateId, enabled: event.target.checked },
        token
      );
      onChanged();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao atualizar');
    }
  }

  async function handleRotateKey() {
    setError(null);
    setRotating(true);
    try {
      const result = await rotateSgpIntegrationKey(integration.id, token);
      setGeneratedKey(result.apiKey);
      onChanged();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao gerar a chave');
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-950">{integration.description}</p>
          <p className="text-sm text-ink-950/55">
            {channel ? channel.name : 'Canal removido'} — {MODE_LABELS[integration.mode] || integration.mode}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-950/70">
          <input
            type="checkbox"
            checked={integration.enabled}
            onChange={handleToggleEnabled}
            aria-label={`Ativo: ${integration.description}`}
            className="h-4 w-4 accent-teal-signal"
          />
          Ativo
        </label>
      </div>
      <p className="text-sm text-ink-950/55">{integration.hasApiKey ? 'Uma chave já foi gerada.' : 'Nenhuma chave foi gerada ainda.'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleRotateKey}
          disabled={rotating}
          className="rounded-lg bg-teal-signal px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Gerar nova chave
        </button>
        {!editing && (
          <button
            onClick={handleStartEdit}
            className="rounded-lg border border-ink-950/15 bg-white/60 px-3 py-2 text-sm font-medium text-ink-950 transition hover:bg-white/90"
          >
            Editar
          </button>
        )}
      </div>
      {editing && (
        <form
          onSubmit={handleSaveEdit}
          aria-label={`Editar integração: ${integration.description}`}
          className="space-y-3 rounded-xl border border-white/70 bg-white/40 p-4"
        >
          <div>
            <label htmlFor={`sgp-edit-description-${integration.id}`} className={labelClass}>Descrição</label>
            <input
              id={`sgp-edit-description-${integration.id}`}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`sgp-edit-channel-${integration.id}`} className={labelClass}>Canal</label>
            <select
              id={`sgp-edit-channel-${integration.id}`}
              value={editChannelId}
              onChange={(e) => setEditChannelId(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecione um canal</option>
              {editableChannels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {editIsTemplateMode && (
            <div>
              <label htmlFor={`sgp-edit-default-template-${integration.id}`} className={labelClass}>Template padrão (opcional)</label>
              <select
                id={`sgp-edit-default-template-${integration.id}`}
                value={editDefaultTemplateId}
                onChange={(e) => setEditDefaultTemplateId(e.target.value)}
                className={inputClass}
              >
                <option value="">Nenhum</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={savingEdit}
              className="rounded-xl bg-gradient-to-r from-amber-signal to-amber-signal-dark px-4 py-2.5 font-medium text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,169,60,0.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="rounded-lg border border-ink-950/15 bg-white/60 px-3 py-2 text-sm font-medium text-ink-950 transition hover:bg-white/90"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {generatedKey && (
        <div className="rounded-lg border border-amber-signal/50 bg-amber-signal/10 px-3 py-2 text-sm text-ink-950">
          <p className="font-medium">Copie agora — esta chave não será mostrada novamente:</p>
          <code className="mt-1 block break-all rounded bg-white/70 px-2 py-1">{generatedKey}</code>
        </div>
      )}
      {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function IntegrationsAdminTab() {
  const { token } = useAuth();
  const { integrations, refresh } = useSgpIntegrations();
  const { channels } = useChannels();
  const { templates } = useTemplates();
  // Each channel gets at most one SGP gateway (one for Baileys, one for Meta Cloud) —
  // already-integrated channels are hidden here; edit the existing card instead of creating a duplicate.
  const eligibleChannels = channels.filter(
    (channel) =>
      (channel.type === 'baileys' || channel.type === 'meta_cloud') &&
      !integrations.some((integration) => integration.channelId === channel.id)
  );

  const [description, setDescription] = useState('');
  const [channelId, setChannelId] = useState('');
  const [defaultTemplateId, setDefaultTemplateId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const selectedChannel = channels.find((c) => c.id === channelId);
  const isTemplateMode = Boolean(selectedChannel && selectedChannel.type === 'meta_cloud');
  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');

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
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao cadastrar a integração');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SgpQueryConfigCard />
      <div className="space-y-3">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} channels={channels} templates={approvedTemplates} onChanged={refresh} />
        ))}
      </div>
      <form onSubmit={handleCreate} className={cardClass}>
        <h3 className="font-display text-base font-semibold text-ink-950">Nova integração SGP</h3>
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
              {approvedTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </div>
        )}
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
          Cadastrar
        </button>
      </form>
    </div>
  );
}

export default IntegrationsAdminTab;
