import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { updateSgpIntegration, rotateSgpIntegrationKey } from '../../services/api';
import { isOfficialChannelType } from '../../utils/channelTypes';
import { Button, DangerZone } from '../ui';
import { descreverErro } from '../../utils/errorMessages';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-accent/60 focus:bg-wa-panel focus:ring-2 focus:ring-focus-ring/40';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-[16px] border border-white/[0.09] bg-ui-surface-card/95 p-4';

const MODE_LABELS = { freetext: 'Texto livre (Baileys)', template: 'Template (oficial)' };

function SgpIntegrationCard({ integration, channels, templates, onChanged }) {
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
  const editableChannels = channels.filter((c) => c.type === 'baileys' || isOfficialChannelType(c.type));
  const editSelectedChannel = channels.find((c) => c.id === editChannelId);
  const editIsTemplateMode = Boolean(editSelectedChannel && isOfficialChannelType(editSelectedChannel.type));

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
      setError(descreverErro(err, 'Falha ao atualizar'));
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
      setError(descreverErro(err, 'Falha ao atualizar'));
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
      setError(descreverErro(err, 'Falha ao gerar a chave'));
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-wa-text">{integration.description}</p>
          <p className="text-sm text-wa-muted">
            {channel ? channel.name : 'Canal removido'} — {MODE_LABELS[integration.mode] || integration.mode}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-wa-muted">
          <input
            type="checkbox"
            checked={integration.enabled}
            onChange={handleToggleEnabled}
            aria-label={`Ativo: ${integration.description}`}
            className="h-4 w-4 accent-accent"
          />
          Ativo
        </label>
      </div>
      <p className="text-sm text-wa-muted">{integration.hasApiKey ? 'Uma chave já foi gerada.' : 'Nenhuma chave foi gerada ainda.'}</p>
      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={handleStartEdit}>Editar</Button>
        </div>
      )}
      {editing && (
        <form
          onSubmit={handleSaveEdit}
          aria-label={`Editar integração: ${integration.description}`}
          className="space-y-3 rounded-xl border border-wa-surface-line bg-wa-surface-soft p-4"
        >
          <div className="grid gap-3 md:grid-cols-2">
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
            <Button type="submit" disabled={savingEdit}>Salvar</Button>
            <Button variant="secondary" type="button" onClick={handleCancelEdit}>Cancelar</Button>
          </div>
        </form>
      )}
      {generatedKey && (
        <div className="rounded-lg border border-wa-warn-text/40 bg-wa-warn-bg px-3 py-2 text-sm text-wa-text">
          <p className="font-medium">Copie agora — esta chave não será mostrada novamente:</p>
          <code className="mt-1 block break-all rounded bg-wa-surface px-2 py-1">{generatedKey}</code>
        </div>
      )}
      {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
      <DangerZone title="Gerar nova chave" description="A chave atual deixa de funcionar assim que uma nova for gerada.">
        <Button variant="danger" onClick={handleRotateKey} disabled={rotating}>
          Gerar nova chave
        </Button>
      </DangerZone>
    </div>
  );
}

export default SgpIntegrationCard;
