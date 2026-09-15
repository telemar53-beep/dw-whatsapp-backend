import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { transferConversation } from '../services/api';
import WaDialog, { waGhostButtonClass } from './WaDialog';
import { AsyncState } from './ui';

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  const { agents: allAgents, status } = useAgents();
  const agents = allAgents.filter((a) => a.id !== agent.id);

  async function handleSelect(toAgentId) {
    await transferConversation(conversationId, toAgentId, token);
    onClose();
  }

  return (
    <WaDialog title="Transferir para" onClose={onClose} size="max-w-sm">
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-6 py-1">
        <AsyncState status={status} isEmpty={agents.length === 0} emptyMessage="Nenhum outro atendente disponível.">
          <ul>
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => handleSelect(a.id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-wa-hover"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-avatar text-[13px] font-medium text-wa-avatar-text"
                  >
                    {(a.name || a.email || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-wa-text">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </AsyncState>
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
        <button onClick={onClose} className={waGhostButtonClass}>
          Cancelar
        </button>
      </div>
    </WaDialog>
  );
}

export default TransferModal;
