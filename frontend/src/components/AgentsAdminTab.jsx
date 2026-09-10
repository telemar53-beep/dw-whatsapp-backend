import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { useSectors } from '../hooks/useSectors';
import { setAgentActive, setAgentSectors } from '../services/api';
import CreateAgentForm from './CreateAgentForm';

function AgentRow({ agentRow, currentAgent, sectors, onToggleActive, onSectorsSaved }) {
  const { token } = useAuth();
  const [editingSectors, setEditingSectors] = useState(false);
  const [selectedIds, setSelectedIds] = useState(agentRow.sectors.map((s) => s.id));
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink-950">{agentRow.name}</p>
          <p className="text-sm text-ink-950/55">
            {agentRow.email} — {agentRow.role === 'admin' ? 'Administrador' : 'Atendente'}
          </p>
          <p className="text-sm text-ink-950/55">
            Setores: {agentRow.sectors.length > 0 ? agentRow.sectors.map((s) => s.name).join(', ') : 'Nenhum setor'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${agentRow.active ? 'text-teal-signal' : 'text-ink-950/40'}`}>
            {agentRow.active ? 'Ativo' : 'Desativado'}
          </span>
          <button
            onClick={handleEditSectorsClick}
            className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline"
          >
            Editar setores
          </button>
          {agentRow.id !== currentAgent?.id && (
            <button
              onClick={() => onToggleActive(agentRow)}
              className="text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline"
            >
              {agentRow.active ? 'Desativar' : 'Reativar'}
            </button>
          )}
        </div>
      </div>
      {editingSectors && (
        <div className="mt-3 space-y-2 rounded-2xl border border-white/70 bg-white/50 p-3 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
          {sectors.map((sector) => (
            <label key={sector.id} className="flex items-center gap-2 text-sm text-ink-950/70">
              <input
                type="checkbox"
                checked={selectedIds.includes(sector.id)}
                onChange={() => toggleSector(sector.id)}
                className="h-4 w-4 accent-teal-signal"
              />
              {sector.name}
            </label>
          ))}
          {error && <p className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveSectors}
              disabled={submitting}
              className="rounded-lg bg-teal-signal px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-ink-950/15 bg-white/50 px-3 py-1.5 text-sm font-medium text-ink-950/70 transition hover:bg-white/80 hover:text-ink-950"
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
          className="rounded-lg border border-ink-950/15 bg-white/60 px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-white/90"
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
