import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { transferConversation } from '../services/api';

function TransferModal({ conversationId, onClose }) {
  const { token, agent } = useAuth();
  const agents = useAgents().filter((a) => a.id !== agent.id);

  async function handleSelect(toAgentId) {
    await transferConversation(conversationId, toAgentId, token);
    onClose();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-[90vw] max-w-72 rounded bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold text-gray-800">Transferir para</h3>
        <ul className="mb-3 space-y-1">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => handleSelect(a.id)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
              >
                {a.email}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose} className="w-full rounded bg-gray-200 py-2 text-sm text-gray-700">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default TransferModal;
