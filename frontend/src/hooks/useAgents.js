import { useEffect } from 'react';
import { useAgentsContext } from '../contexts/AgentsContext';

// A forma devolvida é a mesma de sempre. O que mudou é de onde vem: antes cada
// chamada criava um recurso próprio, agora todas leem a mesma cópia do
// <AgentsProvider>. Ver contexts/AgentsContext.jsx.
export function useAgents() {
  const { agents, status, error, refresh, registrar } = useAgentsContext();
  // Registrar aqui é o que diz ao provider que alguém está usando a lista:
  // sem nenhum consumidor montado, ele não busca e não reage a evento.
  useEffect(() => registrar(), [registrar]);
  return { agents, status, error, loading: status === 'loading', refresh };
}
