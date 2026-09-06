import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';

function sortAgents(agents, onlineIds) {
  return [...agents].sort((a, b) => {
    const aOnline = onlineIds.has(a.id);
    const bOnline = onlineIds.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TeamPanel() {
  const agents = useAgents();
  const onlineIds = usePresence(agents);
  const sorted = sortAgents(agents, onlineIds);

  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">Equipe</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum atendente cadastrado.</p>
      ) : (
        <ul className="space-y-1">
          {sorted.map((agent) => (
            <li key={agent.id} className="flex items-center gap-2 text-sm text-gray-700">
              <span
                title={onlineIds.has(agent.id) ? 'Online' : 'Offline'}
                className={`inline-block h-2 w-2 rounded-full ${
                  onlineIds.has(agent.id) ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
              {agent.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TeamPanel;
