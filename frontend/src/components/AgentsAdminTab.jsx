import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useSectors } from '../hooks/useSectors';
import { setAgentActive, setAgentSectors, resetAgentPassword } from '../services/api';
import CreateAgentForm from './CreateAgentForm';
import WaDialog, { waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';

function AgentRow({ agentRow, currentAgent, sectors, onToggleActive, onSectorsSaved }) {
  const { token } = useAuth();
  const [editingSectors, setEditingSectors] = useState(false);
  const [selectedIds, setSelectedIds] = useState(agentRow.sectors.map((s) => s.id));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState(null);
  const [generatingPassword, setGeneratingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleGeneratePassword() {
    setPasswordError(null);
    setGeneratingPassword(true);
    try {
      const { newPassword } = await resetAgentPassword(agentRow.id, token);
      setGeneratedPassword(newPassword);
      setCopied(false);
    } catch (err) {
      setPasswordError((err.body && err.body.error) || 'Falha ao gerar senha');
    } finally {
      setGeneratingPassword(false);
    }
  }

  async function handleCopyPassword() {
    await navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
  }

  function handleEditSectorsClick() {
    setSelectedIds(agentRow.sectors.map((s) => s.id));
    setError(null);
    setEditingSectors(true);
  }

  function handleCancel() {
    setSelectedIds(agentRow.sectors.map((s) => s.id));
    setError(null);
    setEditingSectors(false);
  }

  function toggleSector(sectorId) {
    setSelectedIds((prev) => (prev.includes(sectorId) ? prev.filter((id) => id !== sectorId) : [...prev, sectorId]));
  }

  async function handleSaveSectors() {
    setError(null);
    setSubmitting(true);
    try {
      await setAgentSectors(agentRow.id, selectedIds, token);
      setEditingSectors(false);
      onSectorsSaved();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar setores');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-wa-surface-line bg-wa-surface p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-wa-text">{agentRow.name}</p>
          <p className="text-sm text-wa-muted">
            {agentRow.email} — {agentRow.role === 'admin' ? 'Administrador' : 'Atendente'}
          </p>
          <p className="text-sm text-wa-muted">
            Setores: {agentRow.sectors.length > 0 ? agentRow.sectors.map((s) => s.name).join(', ') : 'Nenhum setor'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${agentRow.active ? 'text-wa-link' : 'text-wa-muted'}`}>
            {agentRow.active ? 'Ativo' : 'Desativado'}
          </span>
          <button
            onClick={handleEditSectorsClick}
            className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
          >
            Editar setores
          </button>
          {agentRow.id !== currentAgent?.id && (
            <button
              onClick={handleGeneratePassword}
              disabled={generatingPassword}
              className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline disabled:opacity-50"
            >
              Gerar nova senha
            </button>
          )}
          {agentRow.id !== currentAgent?.id && (
            <button
              onClick={() => onToggleActive(agentRow)}
              className="text-sm font-medium text-wa-link hover:text-wa-link/80 hover:underline"
            >
              {agentRow.active ? 'Desativar' : 'Reativar'}
            </button>
          )}
        </div>
      </div>
      {passwordError && <p className={`mt-2 ${waErrorClass}`}>{passwordError}</p>}
      {generatedPassword && (
        <WaDialog title="Nova senha gerada" onClose={() => setGeneratedPassword(null)} size="max-w-sm">
          <div className="space-y-3 px-6 py-4">
            <p className="text-sm text-wa-muted">
              Copie e repasse essa senha pro atendente — ela só aparece essa vez.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm text-wa-text">
                {generatedPassword}
              </code>
              <button type="button" onClick={handleCopyPassword} className={waPrimaryButtonClass}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
          <div className="flex shrink-0 justify-end px-4 py-3">
            <button type="button" onClick={() => setGeneratedPassword(null)} className={waGhostButtonClass}>
              Fechar
            </button>
          </div>
        </WaDialog>
      )}
      {editingSectors && (
        <div className="mt-3 space-y-2 rounded-2xl border border-wa-surface-line bg-wa-surface p-3 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
          {sectors.map((sector) => (
            <label key={sector.id} className="flex items-center gap-2 text-sm text-wa-muted">
              <input
                type="checkbox"
                checked={selectedIds.includes(sector.id)}
                onChange={() => toggleSector(sector.id)}
                className="h-4 w-4 accent-wa-green"
              />
              {sector.name}
            </label>
          ))}
          {error && <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveSectors}
              disabled={submitting}
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
        </div>
      )}
    </div>
  );
}

function AgentsAdminTab() {
  const { token, agent: currentAgent } = useAuth();
  const { agents, refresh } = useAgentsAdmin();
  const { sectors } = useSectors();
  const [creatingAgent, setCreatingAgent] = useState(false);

  async function handleToggleActive(agentToToggle) {
    await setAgentActive(agentToToggle.id, !agentToToggle.active, token);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {agents.map((agentRow) => (
          <AgentRow
            key={agentRow.id}
            agentRow={agentRow}
            currentAgent={currentAgent}
            sectors={sectors}
            onToggleActive={handleToggleActive}
            onSectorsSaved={refresh}
          />
        ))}
      </div>
      {!creatingAgent && (
        <button
          type="button"
          onClick={() => setCreatingAgent(true)}
          className="rounded-lg border border-wa-border bg-wa-field px-3 py-1.5 text-sm font-medium text-wa-text transition hover:bg-wa-panel"
        >
          Criar atendente
        </button>
      )}
      {creatingAgent && (
        <CreateAgentForm
          onCreated={() => {
            refresh();
            setCreatingAgent(false);
          }}
          onCancel={() => setCreatingAgent(false)}
        />
      )}
    </div>
  );
}

export default AgentsAdminTab;
