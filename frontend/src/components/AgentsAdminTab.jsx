import { useAuth } from '../contexts/AuthContext';
import { useAgentsAdmin } from '../hooks/useAgentsAdmin';
import { setAgentActive } from '../services/api';
import CreateAgentForm from './CreateAgentForm';

function AgentsAdminTab() {
  const { token, agent: currentAgent } = useAuth();
  const { agents, refresh } = useAgentsAdmin();

  async function handleToggleActive(agentToToggle) {
    await setAgentActive(agentToToggle.id, !agentToToggle.active, token);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {agents.map((agentRow) => (
          <div key={agentRow.id} className="flex items-center justify-between rounded border border-gray-200 p-3">
            <div>
              <p className="font-medium text-gray-800">{agentRow.name}</p>
              <p className="text-sm text-gray-500">
                {agentRow.email} — {agentRow.role === 'admin' ? 'Administrador' : 'Atendente'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm ${agentRow.active ? 'text-green-600' : 'text-gray-400'}`}>
                {agentRow.active ? 'Ativo' : 'Desativado'}
              </span>
              {agentRow.id !== currentAgent?.id && (
                <button onClick={() => handleToggleActive(agentRow)} className="text-sm text-blue-600 underline">
                  {agentRow.active ? 'Desativar' : 'Reativar'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <CreateAgentForm onCreated={refresh} />
    </div>
  );
}

export default AgentsAdminTab;
