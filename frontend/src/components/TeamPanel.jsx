import { useCallback, useState } from 'react';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useAlert } from '../hooks/useAlert';
import { sobDemanda, useSobDemanda } from '../utils/sobDemanda';
import { IconeEquipe } from './icones';

// O popup chega quando é aberto: o trilho (que a mesa e a Supervisão baixam)
// não leva a lista nem a folha dele. Se o trecho não baixar, o botão avisa e
// o próximo clique tenta de novo (guardas/bloco1SobDemanda.test.jsx).
const EQUIPE = sobDemanda(() => import('./TeamModal'));

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
// O diálogo já vai por portal para o body (ui/Dialog): o portal a mais que
// havia aqui deixava um <div> vazio no body (C1-13).
//
// A carga de cada um só é buscada com o popup ABERTO (`carga: open`): fechado,
// o botão usa a lista só para contar quem está online, e evento de conversa
// não vira requisição. Quem ouve os eventos é o AgentsProvider.
function TeamPanel() {
  const [open, setOpen] = useState(false);
  const { agents, status, refresh } = useAgents({ carga: open });
  const onlineIds = usePresence(agents);
  const sorted = sortAgents(agents, onlineIds);
  const { avisar, alertDialog } = useAlert();
  const equipeNaoBaixou = useCallback(() => {
    setOpen(false);
    avisar('Não foi possível abrir a equipe. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const Equipe = useSobDemanda(EQUIPE, open, equipeNaoBaixou);

  const onlineCount = sorted.filter((teammate) => onlineIds.has(teammate.id)).length;

  const situacao = status === 'error'
    ? 'não foi possível carregar'
    : status === 'loading' && agents.length === 0
      ? 'carregando'
      : onlineCount > 0 ? `${onlineCount} online` : '';
  const nome = situacao ? `Equipe: ${situacao}` : 'Equipe';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={nome} className="worknav-item">
        <IconeEquipe />
        <span className="worknav-dica" aria-hidden="true">{nome}</span>
      </button>
      {open && (Equipe
        ? <Equipe agents={sorted} onlineIds={onlineIds} status={status} onClose={() => setOpen(false)} onRetry={refresh} />
        : <p role="status" className="sr-only">Abrindo a equipe…</p>)}
      {alertDialog}
    </>
  );
}

export default TeamPanel;
