import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
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

// Botão "Equipe" do trilho da mesa. Clicar abre o popup "Nossa equipe" no
// meio da tela (TeamModal); nada se expande aqui. Antes era uma barra no
// rodapé da lista de conversas; o "N online" que ela mostrava agora está no
// nome e na dica do botão, com os mesmos três estados (carregando, erro e
// online).
// O popup vai por portal para o body: um `position: fixed` dentro de um
// ancestral com overflow ou transform fica preso a ele em vez de à tela. O
// wrapper .chat-theme mantém os tokens escuros do popup.
//
// A carga de cada um só é buscada com o popup ABERTO (`carga: open`): fechado,
// o botão usa a lista só para contar quem está online, e evento de conversa
// não vira requisição. Quem ouve os eventos é o AgentsProvider.
function TeamPanel() {
  const [open, setOpen] = useState(false);
  const { agents, status, refresh } = useAgents({ carga: open });
  const onlineIds = usePresence(agents);
  const sorted = sortAgents(agents, onlineIds);

  const onlineCount = sorted.filter((teammate) => onlineIds.has(teammate.id)).length;

  function openModal() {
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
