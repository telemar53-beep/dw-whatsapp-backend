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
    <div className="rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-800">{agentRow.name}</p>
          <p className="text-sm text-gray-500">
            {agentRow.email} — {agentRow.role === 'admin' ? 'Administrador' : 'Atendente'}
          </p>
          <p className="text-sm text-gray-500">
            Setores: {agentRow.sectors.length > 0 ? agentRow.sectors.map((s) => s.name).join(', ') : 'Nenhum setor'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${agentRow.active ? 'text-green-600' : 'text-gray-400'}`}>
            {agentRow.active ? 'Ativo' : 'Desativado'}
          </span>
          <button onClick={handleEditSectorsClick} className="text-sm text-blue-600 underline">
            Editar setores
          </button>
          {agentRow.id !== currentAgent?.id && (
            <button onClick={() => onToggleActive(agentRow)} className="text-sm text-blue-600 underline">
              {agentRow.active ? 'Desativar' : 'Reativar'}
            </button>
          )}
        </div>
      </div>
      {editingSectors && (
        <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
          {sectors.map((sector) => (
            <label key={sector.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selectedIds.includes(sector.id)} onChange={() => toggleSector(sector.id)} />
              {sector.name}
            </label>
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveSectors}
              disabled={submitting}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button type="button" onClick={handleCancel} className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700">
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
      <CreateAgentForm onCreated={refresh} />
    </div>
  );
}

export default AgentsAdminTab;
