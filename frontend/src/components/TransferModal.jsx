import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { transferConversation } from '../services/api';
import WaDialog, { waGhostButtonClass } from './WaDialog';

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  const agents = useAgents().filter((a) => a.id !== agent.id);

  async function handleSelect(toAgentId) {
    await transferConversation(conversationId, toAgentId, token);
    onClose();
  }

  return (
    <WaDialog title="Transferir para" onClose={onClose} size="max-w-sm">
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto py-1">
        {agents.length === 0 ? (
          <p className="px-6 py-4 text-[14px] text-wa-muted">Nenhum outro atendente disponível.</p>
        ) : (
          <ul>
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => handleSelect(a.id)}
                  className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-wa-hover"
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
        )}
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
