import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useAgentsAdmin } from '../../hooks/useAgentsAdmin';
import { useChannels } from '../../hooks/useChannels';
import { useAssignmentMessageConfig } from '../../hooks/useAssignmentMessageConfig';
import { updateAssignmentMessageConfig } from '../../services/api';
import { inputClass, AsyncState } from '../ui';
import CityStatusDot from './StatusDot';

function AssignmentMessageSection() {
  const { token } = useAuth();
  const { config: fetchedConfig, status, refresh } = useAssignmentMessageConfig();
  const { agents } = useAgentsAdmin(true);
  const { channels } = useChannels(true);
  const [editing, setEditing] = useState(false);
  // Mirrors the backend's response from the last successful save, so the closed
  // summary reflects it immediately instead of waiting on refresh()'s network
  // round-trip (which silently swallows its own errors).
  const [savedConfig, setSavedConfig] = useState(null);
  const config = savedConfig || fetchedConfig;
  const [enabled, setEnabled] = useState(config.enabled);
  const [openingMessage, setOpeningMessage] = useState(config.openingMessage);
  const [closingMessage, setClosingMessage] = useState(config.closingMessage);
  const [agentIds, setAgentIds] = useState(config.agentIds);
  const [channelIds, setChannelIds] = useState(config.channelIds);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleEditClick() {
    setEnabled(config.enabled);
    setOpeningMessage(config.openingMessage);
    setClosingMessage(config.closingMessage);
    setAgentIds(config.agentIds);
    setChannelIds(config.channelIds);
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEnabled(config.enabled);
    setOpeningMessage(config.openingMessage);
    setClosingMessage(config.closingMessage);
    setAgentIds(config.agentIds);
    setChannelIds(config.channelIds);
    setError(null);
    setEditing(false);
  }

  function toggleAgent(agentId) {
    setAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleChannel(channelId) {
    setChannelIds((prev) => (prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId]));
  }

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await updateAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds }, token);
      setSavedConfig(saved);
      setEditing(false);
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="settings-open-form space-y-3 rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 p-4"
      >
        <label className="flex items-center gap-2 text-sm text-wa-muted">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-wa-green" />
          Ativo
        </label>
        <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="assignment-opening-message" className="text-sm font-medium text-wa-text">
            Mensagem de abertura
          </label>
          <textarea
            id="assignment-opening-message"
            value={openingMessage}
            onChange={(e) => setOpeningMessage(e.target.value)}
            placeholder="@chat_saudacao_maiusculo, meu nome é @chat_atendente. Irei iniciar seu atendimento, como posso te ajudar? O protocolo do seu atendimento é @chat_protocolo"
            rows={2}
            className={`${inputClass} min-h-[72px] max-h-56 resize-y [field-sizing:content]`}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="assignment-closing-message" className="text-sm font-medium text-wa-text">
            Mensagem de encerramento
          </label>
          <textarea
            id="assignment-closing-message"
            value={closingMessage}
            onChange={(e) => setClosingMessage(e.target.value)}
            placeholder="Estou encerrando seu atendimento! Qualquer dúvida coloco-me prontamente à disposição."
            rows={2}
            className={`${inputClass} min-h-[72px] max-h-56 resize-y [field-sizing:content]`}
            required
          />
        </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1">
          <p className="text-sm font-medium text-wa-text">Atendentes</p>
          <div className="space-y-1">
            {agents.map((agent) => (
              <label key={agent.id} className="flex items-center gap-2 text-sm text-wa-muted">
                <input
                  type="checkbox"
                  checked={agentIds.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                  className="h-4 w-4 accent-wa-green"
                />
                {agent.name}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-wa-text">Canais</p>
          <div className="space-y-1">
            {channels.map((channel) => (
              <label key={channel.id} className="flex items-center gap-2 text-sm text-wa-muted">
                <input
                  type="checkbox"
                  checked={channelIds.includes(channel.id)}
                  onChange={() => toggleChannel(channel.id)}
                  className="h-4 w-4 accent-wa-green"
                />
                {channel.name}
              </label>
            ))}
          </div>
        </div>
        </div>
        {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-wa-green px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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

  return (
    <div className="rounded-[16px] border border-white/[0.09] bg-[#2b343b]/95 p-5">
      <AsyncState status={status} skeletonLines={2}>
        {config.id === null ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-wa-muted">Nenhuma mensagem configurada ainda.</p>
            <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
              Configurar mensagens
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="settings-assignment-summary">
              <p className="text-sm text-wa-muted">{config.agentIds.length} atendentes, {config.channelIds.length} canais</p>
              <div className="settings-message-pair"><section><h3>Mensagem de abertura</h3><p>{config.openingMessage || 'Não informada'}</p></section><section><h3>Mensagem de encerramento</h3><p>{config.closingMessage || 'Não informada'}</p></section></div>
            </div>
            <div className="flex items-center gap-3">
              <CityStatusDot enabled={config.enabled} />
              <button onClick={handleEditClick} className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline">
                Editar
              </button>
            </div>
          </div>
        )}
      </AsyncState>
    </div>
  );
}

export default AssignmentMessageSection;
