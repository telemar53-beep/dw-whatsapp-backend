import { useEffect } from 'react';
import { useAgentsContext, useCargaVisivel } from '../contexts/AgentsContext';

// A forma devolvida é a mesma de sempre. O que mudou é de onde vem: antes cada
// chamada criava um recurso próprio, agora todas leem a mesma cópia do
// <AgentsProvider>. Ver contexts/AgentsContext.jsx.
//
// `carga: true` é para quem MOSTRA a carga de cada atendente (o popup "Nossa
// equipe" aberto, a "Transferir atendimento"): a lista é conferida ao passar a
// mostrar, e até lá o status é o "carregando" de sempre — ninguém decide com
// carga velha. Quem só usa nomes e presença não pede nada.
export function useAgents({ carga = false } = {}) {
  const { agents, status, error, refresh, registrar } = useAgentsContext();
  // Registrar aqui é o que diz ao provider que alguém está usando a lista:
  // sem nenhum consumidor montado, ele não busca e não reage a evento.
  useEffect(() => registrar(), [registrar]);
  const cargaConferida = useCargaVisivel(carga);
  const statusVisivel = status === 'ready' && !cargaConferida ? 'loading' : status;
  return { agents, status: statusVisivel, error, loading: statusVisivel === 'loading', refresh };
}
