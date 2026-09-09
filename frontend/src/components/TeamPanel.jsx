import { useState } from 'react';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { IconChevronDown, IconTeam } from './icons/WaIcons';

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
  const [open, setOpen] = useState(true);
  const onlineCount = sorted.filter((teammate) => onlineIds.has(teammate.id)).length;

  return (
    <div className="shrink-0 border-t border-white/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/25"
      >
        <span className="text-ink-950/45">
          <IconTeam size={18} />
        </span>
        <span className="text-[14px] font-medium text-ink-950">Equipe</span>
        {onlineCount > 0 && (
          <span className="rounded-full bg-teal-signal/10 px-2 py-[1px] text-[11px] font-medium text-teal-signal">
            {onlineCount} online
          </span>
        )}
        <span className={`ml-auto text-ink-950/45 transition-transform ${open ? '' : '-rotate-90'}`}>
          <IconChevronDown size={18} />
        </span>
      </button>
      {open && (
        <div className="wa-scroll max-h-40 overflow-y-auto pb-2">
          {sorted.length === 0 ? (
            <p className="px-4 pb-2 text-[13px] text-ink-950/50">Nenhum atendente cadastrado.</p>
          ) : (
            <ul>
              {sorted.map((teammate) => (
                <li key={teammate.id} className="flex items-center gap-2 px-4 py-[5px] text-[13.5px] text-ink-950">
                  <span
                    title={onlineIds.has(teammate.id) ? 'Online' : 'Offline'}
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      onlineIds.has(teammate.id) ? 'bg-teal-signal' : 'bg-ink-950/20'
                    }`}
                  />
                  <span className="truncate">{teammate.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default TeamPanel;
