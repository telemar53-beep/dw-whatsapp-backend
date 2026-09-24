import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { listAgents } from '../services/api';
import { useAsyncResource } from '../hooks/useAsyncResource';

const AgentsContext = createContext(null);

// Uma cópia só da lista de atendentes para a sessão inteira.
//
// Antes, cada `useAgents()` era um recurso privado: TeamPanel (sempre montado
// no Atendimento), TransferModal (sob demanda, por cima do TeamPanel) e
// SupervisionPage guardavam cada um a sua cópia e buscavam cada um a sua.
// Abrir o modal de transferência refazia uma requisição cujo resultado já
// estava em memória a dois componentes de distância.
//
// Isto NÃO é um cache com validade. Não existe TTL em lugar nenhum aqui: a
// lista continua sendo buscada de novo exatamente pelos mesmos gatilhos de
// antes — os quatro eventos de socket que o TeamPanel assina e a abertura do
// popup "Nossa equipe". A garantia de frescor é a mesma; o que deixa de haver
// é a cópia repetida.
const VAZIO = [];

// Por que existe uma janela: cada ação na fila emite 2 ou 3 eventos no MESMO
// handler do backend — assumir, transferir e encerrar emitem `queue:removed`,
// `conversation:assigned`/`conversation:closed` e `dashboard:conversation` um
// atrás do outro (src/api/conversations.routes.js:225-596). Sem janela, um
// clique de uma pessoa vira 3 requisições idênticas em cada aba conectada.
//
// A janela agrupa as chamadas que chegam ANTES de a requisição sair, e a
// requisição só parte no fim dela. Chamada que chega depois abre uma janela
// nova e gera a sua própria requisição — por isso agrupar aqui não atrasa
// nem envelhece nada: o pedido que sai já enxerga o estado final da rajada.
const JANELA_MS = 50;

export function AgentsProvider({ children }) {
  const { token } = useAuth();

  // O provider fica na raiz, mas não busca nada enquanto ninguém precisar:
  // quem entra em Configurações e fica lá continua fazendo zero requisição de
  // atendentes, como antes de existir provider nenhum. O contador é ref para
  // que montar/desmontar o modal de transferência não re-renderize a árvore
  // inteira; o estado só muda nas transições 0↔1, que são as que importam.
  const consumidores = useRef(0);
  const [emUso, setEmUso] = useState(false);

  const registrar = useCallback(() => {
    consumidores.current += 1;
    if (consumidores.current === 1) setEmUso(true);
    return () => {
      consumidores.current -= 1;
      if (consumidores.current === 0) setEmUso(false);
    };
  }, []);

  const habilitado = Boolean(token) && emUso;
  const { data, status, error, refresh: buscarAgora } = useAsyncResource(
    () => listAgents(token),
    [token],
    { initial: VAZIO, enabled: habilitado }
  );

  const timer = useRef(null);
  const pendente = useRef(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const refresh = useCallback(() => {
    if (timer.current) return pendente.current;
    pendente.current = new Promise((resolve) => {
      timer.current = setTimeout(() => {
        timer.current = null;
        pendente.current = null;
        resolve(buscarAgora());
      }, JANELA_MS);
    });
    return pendente.current;
  }, [buscarAgora]);

  const valor = useMemo(
    () => ({
      agents: data || VAZIO,
      // Enquanto ninguém registrou, qualquer consumidor que esteja lendo este
      // valor é, por definição, um que vai se registrar no efeito logo em
      // seguida. Devolver 'ready' com lista vazia daria a ele um quadro de
      // "não há ninguém na equipe" antes da primeira busca.
      status: emUso ? status : 'loading',
      error,
      refresh,
      registrar,
    }),
    [data, status, error, refresh, registrar, emUso]
  );

  return <AgentsContext.Provider value={valor}>{children}</AgentsContext.Provider>;
}

// Sem fallback silencioso de propósito. Um provider que nunca foi montado já
// chegou à produção neste projeto escondido atrás de um import que existia;
// aqui a ausência estoura na primeira renderização, em vez de virar uma lista
// vazia que parece dado.
export function useAgentsContext() {
  const contexto = useContext(AgentsContext);
  if (!contexto) {
    throw new Error('useAgents() precisa de <AgentsProvider> acima na árvore.');
  }
  return contexto;
}
