import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useSocket } from '../contexts/SocketContext';
import { IconeEquipe } from './icones';
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

// Botão "Equipe" do trilho da mesa. Clicar abre o popup "Nossa equipe" no
// meio da tela (TeamModal); nada se expande aqui. Antes era uma barra no
// rodapé da lista de conversas; o "N online" que ela mostrava agora está no
// nome e na dica do botão, com os mesmos três estados (carregando, erro e
// online).
// O popup vai por portal para o body: um `position: fixed` dentro de um
// ancestral com overflow ou transform fica preso a ele em vez de à tela. O
// wrapper .chat-theme mantém os tokens escuros do popup.
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

  const situacao = status === 'error'
    ? 'não foi possível carregar'
    : status === 'loading' && agents.length === 0
      ? 'carregando'
      : onlineCount > 0 ? `${onlineCount} online` : '';
  const nome = situacao ? `Equipe: ${situacao}` : 'Equipe';

  return (
    <>
      <button type="button" onClick={openModal} aria-haspopup="dialog" aria-expanded={open} aria-label={nome} className="worknav-item">
        <IconeEquipe />
        <span className="worknav-dica" aria-hidden="true">{nome}</span>
      </button>
      {open &&
        createPortal(
          <div className="chat-theme">
            <TeamModal agents={sorted} onlineIds={onlineIds} status={status} onClose={() => setOpen(false)} onRetry={refresh} />
          </div>,
          document.body
        )}
    </>
  );
}

export default TeamPanel;
