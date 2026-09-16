import { useEffect, useState } from 'react';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useSocket } from '../contexts/SocketContext';
import { IconChevronDown, IconTeam, IconChats } from './icons/WaIcons';
import AgentAvatar from './AgentAvatar';
import { AsyncState } from './ui';
import { formatLastSeen } from '../utils/formatLastSeen';

function sortAgents(agents, onlineIds) {
  return [...agents].sort((a, b) => {
    const aOnline = onlineIds.has(a.id);
    const bOnline = onlineIds.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Só o primeiro nome cabe na largura da coluna; o nome inteiro fica no title.
function firstName(name) {
  const trimmed = String(name || '').trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Eventos que mudam "quantos atendimentos cada um tem": a lista de agentes é
// buscada de novo para a contagem acompanhar o que acontece na fila.
const REFRESH_EVENTS = ['conversation:assigned', 'conversation:closed', 'queue:removed', 'dashboard:conversation'];

function StatusChip({ busy }) {
  return busy ? (
    <span className="flex shrink-0 items-center gap-2 rounded-[10px] border border-chat-orange/40 bg-chat-orange/15 px-2.5 py-1 text-[12px] font-medium text-[#ff9a6e]">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-chat-orange" />
      Em atendimento
    </span>
  ) : (
    <span className="flex shrink-0 items-center gap-2 rounded-[10px] border border-chat-online/40 bg-chat-online/15 px-2.5 py-1 text-[12px] font-medium text-chat-online">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-chat-online" />
      Disponível
    </span>
  );
}

function TeammateCard({ teammate, online }) {
  const active = teammate.activeConversations || 0;
  const lastSeen = formatLastSeen(teammate.lastSeenAt);
  return (
    <li className="flex items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.04] px-3 py-2.5">
      <span className="relative shrink-0">
        <AgentAvatar agentId={teammate.id} avatarPath={teammate.avatarPath} name={teammate.name} size={44} />
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#1c1a18] ${
            online ? 'bg-chat-online' : 'bg-white/35'
          }`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span title={teammate.name} className="block truncate text-[15px] font-semibold leading-[19px] text-chat-text">
          {firstName(teammate.name)}
        </span>
        <span className={`block text-[13px] leading-[17px] ${online ? 'text-chat-online' : 'text-chat-muted'}`}>
          {online ? 'Disponível' : 'Offline'}
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] leading-[16px] text-chat-faint">
          {online ? (
            <>
              <IconChats size={14} />
              {plural(active, 'atendimento', 'atendimentos')}
            </>
          ) : (
            <>Última atividade: {lastSeen || 'sem registro'}</>
          )}
        </span>
      </span>
      {online && <StatusChip busy={active > 0} />}
      <span aria-hidden="true" className="-mr-1 shrink-0 -rotate-90 text-chat-faint">
        <IconChevronDown size={16} />
      </span>
    </li>
  );
}

function Section({ tone, title, count, summary, children }) {
  return (
    <section className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-2.5">
      <header className="flex items-center gap-2.5 px-1.5 pb-2.5 pt-1">
        <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${tone === 'online' ? 'bg-chat-online' : 'bg-white/35'}`} />
        <h3 className="text-[13px] font-bold uppercase tracking-[0.02em] text-chat-text">
          {title} ({count})
        </h3>
        <span className="ml-auto text-[13px] text-chat-muted">{summary}</span>
      </header>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function TeamPanel() {
  const { agents, status, refresh } = useAgents();
  const onlineIds = usePresence(agents);
  const socket = useSocket();
  const sorted = sortAgents(agents, onlineIds);
  // Fechado por padrão: o painel só sobe quando o atendente clica em "Equipe".
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!socket || typeof refresh !== 'function') return undefined;
    const handler = () => refresh();
    REFRESH_EVENTS.forEach((event) => socket.on(event, handler));
    return () => REFRESH_EVENTS.forEach((event) => socket.off(event, handler));
  }, [socket, refresh]);

  const online = sorted.filter((teammate) => onlineIds.has(teammate.id));
  const offline = sorted.filter((teammate) => !onlineIds.has(teammate.id));
  const available = online.filter((teammate) => !(teammate.activeConversations > 0)).length;

  function toggle() {
    setOpen((prev) => {
      if (!prev && typeof refresh === 'function') refresh();
      return !prev;
    });
  }

  return (
    <div className="shrink-0 border-t border-white/[0.07]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="team-panel-body"
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.05]"
      >
        <span className="text-chat-icon">
          <IconTeam size={20} />
        </span>
        <span className="text-[15px] font-medium text-chat-text">Equipe</span>
        {online.length > 0 && (
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-[2px] text-[12px] font-medium text-chat-online">
            {online.length} online
          </span>
        )}
        <span className={`ml-auto text-chat-icon transition-transform duration-300 ${open ? '' : 'rotate-180'}`}>
          <IconChevronDown size={20} />
        </span>
      </button>
      <div
        id="team-panel-body"
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {open && (
            <div className="chat-scroll max-h-[55vh] space-y-3 overflow-y-auto px-3 pb-4 pt-1">
              <AsyncState status={status} isEmpty={sorted.length === 0} emptyMessage="Nenhum atendente cadastrado.">
                {online.length > 0 && (
                  <Section tone="online" title="Online" count={online.length} summary={plural(available, 'disponível', 'disponíveis')}>
                    {online.map((teammate) => (
                      <TeammateCard key={teammate.id} teammate={teammate} online />
                    ))}
                  </Section>
                )}
                {offline.length > 0 && (
                  <Section tone="offline" title="Offline" count={offline.length} summary={plural(offline.length, 'indisponível', 'indisponíveis')}>
                    {offline.map((teammate) => (
                      <TeammateCard key={teammate.id} teammate={teammate} online={false} />
                    ))}
                  </Section>
                )}
              </AsyncState>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TeamPanel;
