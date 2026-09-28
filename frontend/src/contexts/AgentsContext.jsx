import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { listAgents } from '../services/api';
import { descreverErro } from '../utils/errorMessages';

const AgentsContext = createContext(null);

// Uma cópia só da lista de atendentes para a sessão inteira.
//
// Antes, cada `useAgents()` era um recurso privado: TeamPanel (sempre montado
// no Atendimento), TransferModal (sob demanda, por cima do TeamPanel) e
// SupervisionPage guardavam cada um a sua cópia e buscavam cada um a sua.
//
// A CARGA de cada atendente (activeConversations) muda a cada conversa
// assumida, transferida ou encerrada. Ela só é buscada quando alguém a MOSTRA:
// o popup "Nossa equipe" aberto ou a "Transferir atendimento" (useAgents com
// `carga: true`). Evento de conversa apenas marca a lista como desatualizada —
// com ninguém mostrando a carga, nenhum evento vira requisição. Antes, o botão
// "Equipe" do trilho buscava /api/agents a cada evento, com o popup fechado,
// e era isso que mantinha atual a carga da transferência (27/09).
//
// Três responsabilidades, explícitas:
//  - invalidar: um evento de conversa torna a lista desatualizada (e, se
//    alguém mostra a carga, agenda uma atualização);
//  - garantir atual: quem passa a mostrar a carga pede a lista atual — nenhuma
//    busca se ela já está atual, uma só se não está, a mesma para todos;
//  - atualizar à força: "Tentar de novo".
//
// A "geração" conta as invalidações. Uma resposta só torna a lista atual se
// nenhuma invalidação aconteceu depois de a busca sair: a resposta velha é
// usada (é a melhor que há), mas não passa por atual.
const VAZIO = [];

// Os eventos que mudam "quantos atendimentos cada um tem".
const EVENTOS_QUE_MUDAM_A_CARGA = ['conversation:assigned', 'conversation:closed', 'queue:removed', 'dashboard:conversation'];

// Por que existe uma janela: cada ação na fila emite 2 ou 3 eventos no MESMO
// handler do backend — assumir, transferir e encerrar emitem `queue:removed`,
// `conversation:assigned`/`conversation:closed` e `dashboard:conversation` um
// atrás do outro (src/api/conversations.routes.js:225-596). Com alguém
// mostrando a carga, a rajada vira UMA atualização. A janela vale só para
// evento e para "Tentar de novo": abrir a equipe ou a transferência não espera.
const JANELA_MS = 50;

export function AgentsProvider({ children }) {
  const { token } = useAuth();
  const socket = useSocket();

  // O provider fica na raiz, mas não busca nada enquanto ninguém precisar:
  // quem entra em Configurações e fica lá continua fazendo zero requisição de
  // atendentes. O contador é ref para que montar/desmontar o modal de
  // transferência não re-renderize a árvore inteira; o estado só muda nas
  // transições 0↔1, que são as que importam.
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
  const [agents, setAgents] = useState(VAZIO);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  // O controle mora em refs do próprio provider: mudar a geração não
  // redesenha ninguém. Só quem mostra a carga assina o aviso (useCargaVisivel).
  const controle = useRef(null);
  if (!controle.current) {
    controle.current = {
      geracao: 0, // quantas invalidações já houve
      confirmada: -1, // a geração que a lista atual descreve
      temDados: false,
      pedido: null, // { geracao, promessa } da busca em andamento
      buscarDeNovo: false, // chegou invalidação com a busca em andamento
      visiveis: 0, // quantos mostram a carga agora
      ouvintes: new Set(),
      timer: null,
      pendente: null,
    };
  }
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (controle.current.timer) clearTimeout(controle.current.timer);
    };
  }, []);

  const api = useMemo(() => {
    const c = controle.current;
    const avisar = () => c.ouvintes.forEach((ouvinte) => ouvinte());
    const estaAtual = () => c.temDados && c.confirmada === c.geracao;

    // Uma busca por vez, compartilhada. Nunca rejeita: o resultado fica no
    // estado (lista, status, erro), e a promessa só diz "terminou".
    function buscar() {
      if (!montado.current) return Promise.resolve();
      if (c.pedido) {
        if (c.pedido.geracao !== c.geracao) c.buscarDeNovo = true;
        return c.pedido.promessa;
      }
      const geracao = c.geracao;
      if (!c.temDados) setStatus('loading');
      const promessa = listAgents(tokenRef.current)
        .then((lista) => {
          if (!montado.current) return;
          c.temDados = true;
          setAgents(lista);
          setStatus('ready');
          setError(null);
          if (c.geracao === geracao) {
            c.confirmada = geracao;
            avisar();
          }
        })
        .catch((erro) => {
          if (!montado.current) return;
          // Os últimos dados válidos ficam (nunca uma carga zero inventada), e
          // a lista continua desatualizada: a próxima abertura tenta de novo.
          setError(descreverErro(erro, (erro && erro.message) || null));
          if (!c.temDados) setStatus(erro && erro.status === 403 ? 'forbidden' : 'error');
        })
        .finally(() => {
          c.pedido = null;
          if (!c.buscarDeNovo) return;
          c.buscarDeNovo = false;
          // No máximo UMA busca a seguir, e só se alguém ainda mostra a carga.
          if (montado.current && c.visiveis > 0 && !estaAtual()) buscar();
        });
      c.pedido = { geracao, promessa };
      return promessa;
    }

    function agendar() {
      // Na desmontagem o provider ainda invalida (limpeza dos efeitos), mas
      // não deixa busca agendada para depois de sair.
      if (!montado.current) return Promise.resolve();
      if (c.timer) return c.pendente;
      c.pendente = new Promise((resolve) => {
        c.timer = setTimeout(() => {
          c.timer = null;
          c.pendente = null;
          resolve(buscar());
        }, JANELA_MS);
      });
      return c.pendente;
    }

    function invalidar() {
      c.geracao += 1;
      avisar();
      if (c.visiveis > 0) agendar();
    }

    // Espera no máximo duas buscas: a que já estava em andamento (de uma
    // geração anterior) e a que sai logo depois dela.
    function garantirAtual() {
      if (estaAtual()) return Promise.resolve();
      return buscar().then(() => (!estaAtual() && c.pedido ? c.pedido.promessa : undefined));
    }

    // "Tentar de novo" e quem quiser a lista de novo agora.
    function atualizarAgora() {
      c.geracao += 1;
      avisar();
      return agendar();
    }

    function mostrarCarga() {
      c.visiveis += 1;
      let saiu = false;
      return {
        pronto: garantirAtual(),
        sair() {
          if (saiu) return;
          saiu = true;
          c.visiveis -= 1;
        },
      };
    }

    function assinar(ouvinte) {
      c.ouvintes.add(ouvinte);
      return () => c.ouvintes.delete(ouvinte);
    }

    return { buscar, invalidar, garantirAtual, atualizarAgora, mostrarCarga, assinar, estaAtual };
  }, []);

  // 1ª carga, e de novo quando alguém volta a usar a lista depois de todos
  // saírem: enquanto ninguém usa, ninguém ouve os eventos, então a lista
  // sai de cena desatualizada (e também quando o token muda).
  useEffect(() => {
    if (!habilitado) return undefined;
    api.garantirAtual();
    return () => api.invalidar();
  }, [habilitado, token, api]);

  // Um ouvinte por evento, aqui no provider, enquanto alguém usa a lista.
  useEffect(() => {
    if (!socket || !habilitado) return undefined;
    const aoMudar = () => api.invalidar();
    EVENTOS_QUE_MUDAM_A_CARGA.forEach((evento) => socket.on(evento, aoMudar));
    return () => {
      EVENTOS_QUE_MUDAM_A_CARGA.forEach((evento) => socket.off(evento, aoMudar));
      // Daqui em diante ninguém ouve: o que vier não chega até a lista.
      api.invalidar();
    };
  }, [socket, habilitado, api]);

  const valor = useMemo(
    () => ({
      agents,
      // Enquanto ninguém registrou, qualquer consumidor que esteja lendo este
      // valor é, por definição, um que vai se registrar no efeito logo em
      // seguida. Devolver 'ready' com lista vazia daria a ele um quadro de
      // "não há ninguém na equipe" antes da primeira busca.
      status: emUso ? status : 'loading',
      error,
      refresh: api.atualizarAgora,
      registrar,
      carga: api,
    }),
    [agents, status, error, registrar, emUso, api]
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

const nuncaMuda = () => () => {};
const sempreAtual = () => true;

// Quem MOSTRA a carga (`ativo`): garante a lista atual ao passar a mostrar e
// devolve se ela já foi conferida — atual, ou a tentativa terminou (falha
// incluída: aí ficam os últimos dados válidos). Quem não mostra não assina
// nada e não redesenha com evento.
export function useCargaVisivel(ativo) {
  const { carga } = useAgentsContext();
  const [tentada, setTentada] = useState(false);
  // Assina o "está atual?" só até a 1ª conferência: depois dela, a lista
  // fica na tela e se atualiza quando a carga nova chega — a invalidação em si
  // não redesenha ninguém (medido: +70 componentes por evento sem isto).
  const ouvindo = ativo && !tentada;
  const atual = useSyncExternalStore(ouvindo ? carga.assinar : nuncaMuda, ouvindo ? carga.estaAtual : sempreAtual);
  useEffect(() => {
    if (!ativo) {
      setTentada(false);
      return undefined;
    }
    let valendo = true;
    const { pronto, sair } = carga.mostrarCarga();
    pronto.then(() => { if (valendo) setTentada(true); });
    return () => {
      valendo = false;
      sair();
    };
  }, [ativo, carga]);
  return !ativo || atual || tentada;
}
