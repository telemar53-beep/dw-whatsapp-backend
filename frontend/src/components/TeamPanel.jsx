import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useSocket } from '../contexts/SocketContext';
import { IconChevronDown, IconTeam } from './icons/WaIcons';
import TeamModal from './TeamModal';

function sortAgents(agents, onlineIds) {
  return [...agents].sort((a, b) => {
    const aOnline = onlineIds.has(a.id);
    const bOnline = onlineIds.has(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Eventos que mudam "quantos atendimentos cada um tem": a lista de agentes é
// buscada de novo para a contagem acompanhar o que acontece na fila.
const REFRESH_EVENTS = ['conversation:assigned', 'conversation:closed', 'queue:removed', 'dashboard:conversation'];

// Barra "Equipe · N online" no rodapé da lista de conversas. Clicar abre o
// popup "Nossa equipe" no meio da tela (TeamModal); nada se expande aqui.
// O popup vai por portal para o body: a coluna da lista tem backdrop-blur e
// overflow-clip, e um `position: fixed` dentro dela fica preso à coluna em
// vez de à tela. O wrapper .chat-theme mantém os tokens escuros do chat.
function TeamPanel() {
  const { agents, status, refresh } = useAgents();
  const onlineIds = usePresence(agents);
  const socket = useSocket();
  const sorted = sortAgents(agents, onlineIds);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!socket || typeof refresh !== 'function') return undefined;
    const handler = () => refresh();
    REFRESH_EVENTS.forEach((event) => socket.on(event, handler));
    return () => REFRESH_EVENTS.forEach((event) => socket.off(event, handler));
  }, [socket, refresh]);

  const onlineCount = sorted.filter((teammate) => onlineIds.has(teammate.id)).length;

  function openModal() {
    if (typeof refresh === 'function') refresh();
    setOpen(true);
  }

  return (
    <div className="shrink-0 border-t border-white/[0.07]">
      <button
        type="button"
        onClick={openModal}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.05]"
      >
        <span className="text-chat-icon">
          <IconTeam size={20} />
        </span>
        <span className="text-[15px] font-medium text-chat-text">Equipe</span>
        {/* Carregando e erro eram invisíveis na barra (ATD-EQP-03/04). */}
        {status === 'loading' && agents.length === 0 && <span className="text-[12px] text-wa-muted">Carregando…</span>}
        {status === 'error' && <span className="text-[12px] text-wa-error-text">Não foi possível carregar</span>}
        {status !== 'error' && onlineCount > 0 && (
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-[2px] text-[12px] font-medium text-chat-online">
            {onlineCount} online
          </span>
        )}
        <span className="ml-auto rotate-180 text-chat-icon">
          <IconChevronDown size={20} />
        </span>
      </button>
      {open &&
        createPortal(
          <div className="chat-theme">
            <TeamModal agents={sorted} onlineIds={onlineIds} status={status} onClose={() => setOpen(false)} onRetry={refresh} />
          </div>,
          document.body
        )}
    </div>
  );
}

export default TeamPanel;
