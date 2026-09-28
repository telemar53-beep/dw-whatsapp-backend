import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { usePresence } from '../hooks/usePresence';
import {
  getDashboardClosedToday,
  getDashboardConversationByProtocol,
  getDashboardConversationsByPhone,
} from '../services/api';
import TrilhoDaMesa, { IconeDoMenu } from '../components/TrilhoDaMesa';
import { IconeBuscar } from '../components/icones';
import ListaDaSupervisao from '../components/supervisao/ListaDaSupervisao';
import IndicadoresDaSupervisao from '../components/supervisao/IndicadoresDaSupervisao';
import FiltrosDaSupervisao, { ChipsDosFiltros } from '../components/supervisao/FiltrosDaSupervisao';
import EncerradosDaSupervisao, { ResultadoDoTelefone } from '../components/supervisao/EncerradosDaSupervisao';
import { EquipeLateral, BotaoDaEquipe, FolhaDaEquipe } from '../components/supervisao/EquipeDaSupervisao';
import { RelogioDaSupervisao } from '../components/supervisao/Relogio';
import {
  AI_AGENT_FILTER,
  isHandledByAi,
  correspondeAosFiltros,
  criarBusca,
  tipoDaBusca,
  ordenarEspera,
} from '../components/supervisao/regras';
import { descreverErro } from '../utils/errorMessages';
import { aplicarContatoSalvo } from '../utils/contatoSalvo';
import { shortenAgentNames } from '../utils/agentDisplayName';
import './supervisao.css';

// Mantidos para quem importava daqui.
export { AI_AGENT_FILTER, isHandledByAi };

// O popup de sempre e a transferência chegam quando são abertos: quem só olha
// a fila não baixa nem avalia a conversa inteira (auditoria de 27/09).
//
// Sem React.lazy de propósito: o lazy suspende no primeiro render mesmo com
// o módulo já em memória, e o React 18 segura a troca do fallback pelo
// conteúdo por até 500 ms (FALLBACK_THROTTLE_MS) — medido em 27/09, a primeira
// abertura com CPU 4× ficava ~130 ms (mediana) mais lenta que a da página
// antiga mesmo com o trecho já baixado. Aqui, com o trecho em memória, o
// popup abre no mesmo render do clique; se o trecho não baixar, a página
// avisa em vez de a falha subir até a rota.
function sobDemanda(carregar) {
  const modulo = { componente: null, pedido: null };
  modulo.carregar = () => {
    if (!modulo.pedido) {
      modulo.pedido = carregar()
        .then((m) => { modulo.componente = m.default; return m.default; })
        .catch((erro) => { modulo.pedido = null; throw erro; });
    }
    return modulo.pedido;
  };
  return modulo;
}
const POPUP = sobDemanda(() => import('../components/supervisao/PopupDaSupervisao'));
const TRANSFERENCIA = sobDemanda(() => import('../components/TransferModal'));

// Pré-carga por intenção: ponteiro ou foco entrando na lista já pede o trecho
// da conversa, e o clique chega com ele em memória. Quem só olha a página sem
// chegar perto da lista continua sem baixar nada.
function precarregarPopup() {
  POPUP.carregar().catch(() => {});
}

// O componente do módulo quando ele é preciso; enquanto o trecho baixa, null.
function useSobDemanda(modulo, preciso, aoFalhar) {
  const [, setCarregado] = useState(0);
  useEffect(() => {
    if (!preciso || modulo.componente) return undefined;
    let valendo = true;
    modulo.carregar().then(
      () => { if (valendo) setCarregado((n) => n + 1); },
      () => { if (valendo) aoFalhar(); }
    );
    return () => { valendo = false; };
  }, [preciso, modulo, aoFalhar]);
  return preciso ? modulo.componente : null;
}

const TAMANHO_DA_PAGINA = 20;
const NENHUM = Object.freeze([]);
const ID_DO_CAMPO_DE_BUSCA = 'sv-busca-campo';
const SEP_CAMPO = '\u0001';
const SEP_ITEM = '\u0002';

// A URL guarda os filtros (canal, atendente, setor, repetidos) e a aba. As
// listas só trocam de referência quando o texto delas muda: outro parâmetro
// na URL não refaz a lista nem o que depende dela.
function useListaDaUrl(searchParams, chave) {
  const texto = searchParams.getAll(chave).join('\n');
  return useMemo(() => (texto ? texto.split('\n') : NENHUM), [texto]);
}

// Nome do responsável para o popup, como antes: o atendente, ou "IA" no que a
// própria IA encerrou.
function comNomeDoAgente(conversa, rotulos) {
  const agente = conversa.assignedAgentId ? rotulos.get(conversa.assignedAgentId) : null;
  if (agente) return { ...conversa, assignedAgentName: agente.completo, assignedAgentShortName: agente.curto };
  if (conversa.status === 'closed' && isHandledByAi(conversa)) return { ...conversa, assignedAgentName: 'IA' };
  return conversa;
}

// Campanha silenciosa só entra quando o cliente responde.
function filtrarLista(lista, filtros) {
  return lista.filter((c) => c.status !== 'silent' && correspondeAosFiltros(c, filtros));
}

function sufixoDoVazio(temFiltro, temBusca) {
  if (temFiltro && temBusca) return ' com os filtros e a busca atuais.';
  if (temFiltro) return ' com os filtros atuais.';
  if (temBusca) return ' com a busca atual.';
  return '.';
}

function SupervisionPage() {
  const { token } = useAuth();
  const contexto = useOutletContext() || {};
  const { openProfile, closeMobileNav, profileVersion, mobileNavOpen, encaixeDoTrilho, encaixeDoIcone } = contexto;

  // Painel ao vivo. Esconder os dados é a exceção: só quando se sabe que está
  // carregando, que falhou ou que não há acesso — e aí os números viram "—".
  const {
    inProgress, waiting, inAutomation, closedTodayCount,
    status: statusDoPainel, refresh: recarregarPainel, aplicarContatoSalvo: aplicarNoPainel,
  } = useAttendanceDashboard();
  const dadosVisiveis = statusDoPainel !== 'loading' && statusDoPainel !== 'error' && statusDoPainel !== 'forbidden';

  const { channels } = useChannels(true);
  const { agents, status: statusDaEquipe } = useAgents();
  const onlineIds = usePresence(agents);
  const { sectors } = useSectors();

  // ---------- URL: filtros e aba ----------
  const [searchParams, setSearchParams] = useSearchParams();
  // O setter do router muda de identidade a cada mudança da URL; pela ref, as
  // ações abaixo ficam estáveis e não derrubam o memo de quem as recebe.
  const setParamsRef = useRef(setSearchParams);
  setParamsRef.current = setSearchParams;
  const canais = useListaDaUrl(searchParams, 'canal');
  const atendentes = useListaDaUrl(searchParams, 'atendente');
  const setores = useListaDaUrl(searchParams, 'setor');
  const aba = searchParams.get('aba') === 'encerrados' ? 'encerrados' : 'ao-vivo';
  const temFiltro = canais.length > 0 || atendentes.length > 0 || setores.length > 0;

  const mudarParams = useCallback((mudar) => {
    setParamsRef.current((anterior) => {
      const proximo = new URLSearchParams(anterior);
      mudar(proximo);
      return proximo;
    }, { replace: true });
  }, []);
  const alternarFiltro = useCallback((chave, valor) => mudarParams((p) => {
    const atuais = p.getAll(chave);
    p.delete(chave);
    (atuais.includes(valor) ? atuais.filter((v) => v !== valor) : [...atuais, valor]).forEach((v) => p.append(chave, v));
  }), [mudarParams]);
  const removerFiltro = useCallback((chave, valor) => mudarParams((p) => {
    const restantes = p.getAll(chave).filter((v) => v !== valor);
    p.delete(chave);
    restantes.forEach((v) => p.append(chave, v));
  }), [mudarParams]);
  // Só os três filtros: a aba e o resto da URL ficam onde estavam.
  const limparFiltros = useCallback(() => mudarParams((p) => {
    p.delete('canal');
    p.delete('atendente');
    p.delete('setor');
  }), [mudarParams]);
  const mudarAba = useCallback((proxima) => mudarParams((p) => {
    if (proxima === 'encerrados') p.set('aba', 'encerrados');
    else p.delete('aba');
  }), [mudarParams]);

  const filtros = useMemo(() => ({ channelIds: canais, agentIds: atendentes, sectorIds: setores }), [canais, atendentes, setores]);
  const selecionados = useMemo(() => ({ canal: canais, atendente: atendentes, setor: setores }), [canais, atendentes, setores]);

  // ---------- Nomes ----------
  // A lista de atendentes volta do servidor a cada evento da fila (o botão
  // "Equipe" do trilho a busca de novo para a carga acompanhar): objetos
  // novos com os mesmos nomes. Os rótulos dependem só de id e nome — trocar
  // a referência a cada busca redesenhava todas as linhas e o popup (medido
  // em 27/09: 11 de 10 linhas por evento).
  const chaveDosNomes = agents.map((a) => `${a.id}${SEP_CAMPO}${a.name || a.email}`).join(SEP_ITEM);
  const nomes = useMemo(
    () => (chaveDosNomes ? chaveDosNomes.split(SEP_ITEM).map((par) => par.split(SEP_CAMPO)) : NENHUM),
    [chaveDosNomes]
  );
  const rotulos = useMemo(() => {
    const curtos = shortenAgentNames(nomes.map(([, nome]) => nome));
    return new Map(nomes.map(([id, nome], i) => [id, { curto: curtos[i], completo: nome }]));
  }, [nomes]);
  const opcoes = useMemo(() => ({
    canal: channels.map((c) => ({ value: c.id, label: c.name })),
    atendente: [{ value: AI_AGENT_FILTER, label: 'IA' }, ...nomes.map(([id, nome]) => ({ value: id, label: nome }))],
    setor: sectors.map((s) => ({ value: s.id, label: s.name })),
  }), [channels, nomes, sectors]);
  const chips = useMemo(() => {
    const nomeDe = (lista, valor) => lista.find((o) => o.value === valor)?.label || 'indisponível';
    return [
      ...canais.map((valor) => ({ chave: 'canal', titulo: 'Canal', valor, rotulo: nomeDe(opcoes.canal, valor) })),
      ...atendentes.map((valor) => ({ chave: 'atendente', titulo: 'Atendente', valor, rotulo: nomeDe(opcoes.atendente, valor) })),
      ...setores.map((valor) => ({ chave: 'setor', titulo: 'Setor', valor, rotulo: nomeDe(opcoes.setor, valor) })),
    ];
  }, [canais, atendentes, setores, opcoes]);

  // ---------- Busca única ----------
  const [textoDaBusca, setTextoDaBusca] = useState('');
  const [erroDaBusca, setErroDaBusca] = useState(null);
  const [encontrada, setEncontrada] = useState(null);
  const [resultadoTelefone, setResultadoTelefone] = useState(null);
  const busca = useMemo(() => criarBusca(textoDaBusca), [textoDaBusca]);
  const erroDaBuscaId = useId();

  // ---------- Listas ao vivo ----------
  // Cada lista é filtrada à parte: um evento na Espera não refaz as outras duas.
  const esperaFiltrada = useMemo(() => ordenarEspera(filtrarLista(waiting, filtros)), [waiting, filtros]);
  const atendimentoFiltrado = useMemo(() => filtrarLista(inProgress, filtros), [inProgress, filtros]);
  const automacaoFiltrada = useMemo(() => filtrarLista(inAutomation, filtros), [inAutomation, filtros]);
  const espera = useMemo(() => (busca ? esperaFiltrada.filter(busca) : esperaFiltrada), [esperaFiltrada, busca]);
  const atendimento = useMemo(() => (busca ? atendimentoFiltrado.filter(busca) : atendimentoFiltrado), [atendimentoFiltrado, busca]);
  const automacao = useMemo(() => (busca ? automacaoFiltrada.filter(busca) : automacaoFiltrada), [automacaoFiltrada, busca]);
  const grupos = useMemo(() => ({ espera, atendimento, automacao }), [espera, atendimento, automacao]);

  const [visao, setVisao] = useState('todos');
  const alternarVisao = useCallback((chave) => setVisao((atual) => (atual === chave ? 'todos' : chave)), []);
  const totalVisivel = (visao === 'todos' || visao === 'espera' ? espera.length : 0)
    + (visao === 'todos' || visao === 'atendimento' ? atendimento.length : 0)
    + (visao === 'todos' || visao === 'automacao' ? automacao.length : 0);
  const estadoDaLista = statusDoPainel === 'loading' ? 'carregando'
    : statusDoPainel === 'error' ? 'erro'
      : statusDoPainel === 'forbidden' ? 'sem-acesso' : 'pronto';

  // ---------- Equipe ----------
  // A carga vem do painel NÃO filtrado: filtrar a tela não muda quantas
  // conversas o atendente tem de verdade.
  const cargaPorAtendente = useMemo(() => {
    const mapa = new Map();
    for (const conversa of inProgress) {
      if (!conversa.assignedAgentId) continue;
      mapa.set(conversa.assignedAgentId, (mapa.get(conversa.assignedAgentId) || 0) + 1);
    }
    return mapa;
  }, [inProgress]);
  // Quem está online e com mais carga sobe; offline desce.
  const equipe = useMemo(() => agents
    .map((a) => ({
      id: a.id,
      rotulo: rotulos.get(a.id).curto,
      completo: rotulos.get(a.id).completo,
      online: onlineIds.has(a.id),
      carga: cargaPorAtendente.get(a.id) || 0,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.carga - a.carga || a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
  [agents, rotulos, onlineIds, cargaPorAtendente]);
  const totalOnline = useMemo(() => equipe.filter((e) => e.online).length, [equipe]);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const abrirFolha = useCallback(() => setFolhaAberta(true), []);
  const fecharFolha = useCallback(() => setFolhaAberta(false), []);
  const irParaEquipe = useCallback(() => document.getElementById('sv-equipe-busca')?.focus(), []);

  // ---------- Últimas 24 h (só quando a aba abre) ----------
  // Com canal, atendente ou setor, o servidor filtra e devolve o total. Com o
  // atendente "IA", que o servidor não conhece, a busca vai sem filtro e o
  // filtro roda no que já carregou — como antes.
  const modoIa = atendentes.includes(AI_AGENT_FILTER);
  const chaveDoServidor = modoIa ? '{}' : JSON.stringify({
    ...(canais.length ? { channelIds: canais } : {}),
    ...(atendentes.length ? { agentIds: atendentes } : {}),
    ...(setores.length ? { sectorIds: setores } : {}),
  });
  const [encerrados, setEncerrados] = useState({ itens: NENHUM, offset: 0, temMais: false, carregado: false, total: null });
  const [erroEncerrados, setErroEncerrados] = useState(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const encerradosRef = useRef(encerrados);
  encerradosRef.current = encerrados;
  // Cada busca da 1ª página abre uma geração nova. O "Carregar mais" só
  // anexa se a geração dele ainda for a atual: página 2 de um filtro antigo
  // não se mistura à lista do filtro novo.
  const geracaoRef = useRef(0);

  useEffect(() => {
    if (aba !== 'encerrados' || !token) return undefined;
    let valendo = true;
    geracaoRef.current += 1;
    setCarregandoMais(false);
    setErroEncerrados(null);
    setEncerrados({ itens: NENHUM, offset: 0, temMais: false, carregado: false, total: null });
    getDashboardClosedToday({ offset: 0, limit: TAMANHO_DA_PAGINA, ...JSON.parse(chaveDoServidor) }, token)
      .then((dados) => {
        if (!valendo) return;
        setEncerrados({ itens: dados.items, offset: dados.items.length, temMais: dados.hasMore, carregado: true, total: dados.total ?? null });
      })
      // O erro guarda o escopo: "Tentar de novo" repete a requisição certa, e
      // falhar uma página a mais não joga fora o que já está na tela.
      .catch(() => {
        if (valendo) setErroEncerrados({ mensagem: 'Não foi possível carregar os encerrados das últimas 24 h.', escopo: 'inicial' });
      });
    return () => { valendo = false; };
  }, [aba, token, chaveDoServidor, recarga]);

  const carregarMais = useCallback(() => {
    const geracao = geracaoRef.current;
    setCarregandoMais(true);
    setErroEncerrados(null);
    getDashboardClosedToday({ offset: encerradosRef.current.offset, limit: TAMANHO_DA_PAGINA, ...JSON.parse(chaveDoServidor) }, token)
      .then((dados) => {
        if (geracao !== geracaoRef.current) return;
        setEncerrados((e) => ({
          ...e,
          itens: [...e.itens, ...dados.items],
          offset: e.offset + dados.items.length,
          temMais: dados.hasMore,
          total: dados.total ?? e.total,
        }));
        setCarregandoMais(false);
      })
      .catch(() => {
        if (geracao !== geracaoRef.current) return;
        setCarregandoMais(false);
        setErroEncerrados({ mensagem: 'Não foi possível carregar mais encerrados.', escopo: 'mais' });
      });
  }, [chaveDoServidor, token]);
  const escopoDoErro = erroEncerrados?.escopo;
  const tentarEncerradosDeNovo = useCallback(() => {
    if (escopoDoErro === 'mais') carregarMais();
    else setRecarga((n) => n + 1);
  }, [escopoDoErro, carregarMais]);

  const encerradosVisiveis = useMemo(() => {
    const doFiltro = modoIa ? encerrados.itens.filter((c) => correspondeAosFiltros(c, filtros)) : encerrados.itens;
    return busca ? doFiltro.filter(busca) : doFiltro;
  }, [encerrados.itens, modoIa, filtros, busca]);
  let contagemDeEncerrados = null;
  let avisoDeEncerrados = null;
  if (busca) {
    // A busca roda só no que já carregou: o total do servidor não descreve
    // o que está na tela, então sai, e o aviso diz sobre o que é o número.
    if (encerrados.carregado) {
      const n = encerradosVisiveis.length;
      avisoDeEncerrados = `Busca nos ${encerrados.itens.length} encerrados carregados: ${n} ${n === 1 ? 'resultado' : 'resultados'}.`;
    }
  } else if (!temFiltro) {
    contagemDeEncerrados = dadosVisiveis ? closedTodayCount : '—';
  } else if (erroEncerrados && erroEncerrados.escopo === 'inicial') {
    contagemDeEncerrados = '—';
  } else if (!modoIa) {
    contagemDeEncerrados = encerrados.carregado ? encerrados.total : null;
  } else if (encerrados.carregado) {
    const n = encerradosVisiveis.length;
    if (encerrados.temMais) {
      avisoDeEncerrados = `${n} ${n === 1 ? 'correspondência' : 'correspondências'} entre ${encerrados.itens.length} encerrados carregados. Há mais resultados: use "Carregar mais".`;
    } else {
      contagemDeEncerrados = n;
      avisoDeEncerrados = `${n} de ${encerrados.itens.length} encerrados das últimas 24 h correspondem aos filtros.`;
    }
  }

  // ---------- Popup ----------
  const [selecionadaId, setSelecionadaId] = useState(null);
  const [transferindoId, setTransferindoId] = useState(null);
  const [erroAoAbrir, setErroAoAbrir] = useState(null);
  const abrirConversa = useCallback((id) => {
    setErroAoAbrir(null);
    setSelecionadaId(id);
  }, []);
  const fecharConversa = useCallback(() => setSelecionadaId(null), []);
  const fecharTransferencia = useCallback(() => setTransferindoId(null), []);
  const popupNaoBaixou = useCallback(() => {
    setSelecionadaId(null);
    setErroAoAbrir('Não foi possível abrir a conversa. Verifique a conexão e tente de novo.');
  }, []);
  const transferenciaNaoBaixou = useCallback(() => {
    setTransferindoId(null);
    setErroAoAbrir('Não foi possível abrir a transferência. Verifique a conexão e tente de novo.');
  }, []);

  // A conversa do popup sai destas fontes, nesta ordem. É o MESMO objeto
  // enquanto o evento for de outra conversa — e o popup (memo) fica parado.
  const selecionada = useMemo(() => {
    if (!selecionadaId) return null;
    const achar = (lista) => (lista ? lista.find((c) => c.id === selecionadaId) : undefined);
    return achar(inProgress) || achar(waiting) || achar(inAutomation) || achar(encerrados.itens)
      || (encontrada && encontrada.id === selecionadaId ? encontrada : null)
      || achar(resultadoTelefone?.conversations) || null;
  }, [selecionadaId, inProgress, waiting, inAutomation, encerrados.itens, encontrada, resultadoTelefone]);
  const conversaDoPopup = useMemo(() => (selecionada ? comNomeDoAgente(selecionada, rotulos) : null), [selecionada, rotulos]);
  const Popup = useSobDemanda(POPUP, Boolean(conversaDoPopup), popupNaoBaixou);
  const Transferencia = useSobDemanda(TRANSFERENCIA, Boolean(transferindoId), transferenciaNaoBaixou);

  // "Editar cliente" salvou no popup, e a rota não emite evento: todas as
  // fontes do popup guardam o que voltou do servidor — reabrir não traz o antigo.
  const aoSalvarContato = useCallback((salvo) => {
    aplicarNoPainel(salvo);
    setEncerrados((e) => {
      const itens = aplicarContatoSalvo(e.itens, salvo);
      return itens === e.itens ? e : { ...e, itens };
    });
    setEncontrada((anterior) => (anterior ? aplicarContatoSalvo([anterior], salvo)[0] : anterior));
    setResultadoTelefone((anterior) => {
      if (!anterior) return anterior;
      const conversations = aplicarContatoSalvo(anterior.conversations, salvo);
      return conversations === anterior.conversations ? anterior : { ...anterior, conversations };
    });
  }, [aplicarNoPainel]);

  // ---------- Busca: Enter ----------
  async function aoBuscar(evento) {
    evento.preventDefault();
    setErroDaBusca(null);
    const texto = textoDaBusca.trim();
    const tipo = tipoDaBusca(texto);
    if (tipo === 'protocolo') {
      try {
        const conversa = await getDashboardConversationByProtocol(texto, token);
        setEncontrada(conversa);
        setSelecionadaId(conversa.id);
      } catch (erro) {
        setEncontrada(null);
        setErroDaBusca(descreverErro(erro, 'Nenhum atendimento encontrado com esse protocolo.'));
      }
    } else if (tipo === 'telefone') {
      try {
        setResultadoTelefone(await getDashboardConversationsByPhone(texto, token));
      } catch (erro) {
        setResultadoTelefone(null);
        setErroDaBusca(descreverErro(erro, 'Nenhum cliente encontrado com esse telefone.'));
      }
    }
  }
  // "Limpar busca" some no próprio clique: o foco volta ao campo, e não ao body.
  const limparBusca = useCallback(() => {
    setResultadoTelefone(null);
    setTextoDaBusca('');
    setErroDaBusca(null);
    document.getElementById(ID_DO_CAMPO_DE_BUSCA)?.focus();
  }, []);

  // ---------- Abas ----------
  const abaAoVivoId = useId();
  const abaEncerradosId = useId();
  const painelDaAbaId = useId();
  function aoTeclarNaAba(evento) {
    const destino = { ArrowLeft: 'outra', ArrowRight: 'outra', Home: 'ao-vivo', End: 'encerrados' }[evento.key];
    if (!destino) return;
    evento.preventDefault();
    const proxima = destino === 'outra' ? (aba === 'ao-vivo' ? 'encerrados' : 'ao-vivo') : destino;
    mudarAba(proxima);
    document.getElementById(proxima === 'ao-vivo' ? abaAoVivoId : abaEncerradosId)?.focus();
  }

  const propsDaEquipe = {
    equipe, online: totalOnline, dadosVisiveis, estado: statusDaEquipe, selecionados: atendentes, onAlternar: alternarFiltro,
  };

  return (
    <RelogioDaSupervisao>
      <div className="sv">
        <div className="sv-conteudo">
          <header className="sv-cabecalho">
            <div className="sv-titulos">
              <h1 className="sv-titulo">Supervisão</h1>
              <p className="sv-subtitulo">Operação em tempo real</p>
            </div>
            <BotaoDaEquipe online={totalOnline} dadosVisiveis={dadosVisiveis} aberto={folhaAberta} onAbrir={abrirFolha} />
          </header>

          <div className="sv-barra">
            <form role="search" className="sv-busca" onSubmit={aoBuscar}>
              <IconeBuscar tamanho={18} className="sv-busca-icone" />
              <input
                id={ID_DO_CAMPO_DE_BUSCA}
                type="search"
                value={textoDaBusca}
                onChange={(e) => { setTextoDaBusca(e.target.value); setErroDaBusca(null); }}
                placeholder="Buscar cliente, telefone ou protocolo"
                aria-label="Buscar cliente, telefone ou protocolo"
                aria-describedby={erroDaBusca ? erroDaBuscaId : undefined}
                enterKeyHint="search"
              />
            </form>
            <FiltrosDaSupervisao opcoes={opcoes} selecionados={selecionados} onAlternar={alternarFiltro} />
            <div role="tablist" aria-label="Período" className="sv-abas">
              <button
                id={abaAoVivoId}
                type="button"
                role="tab"
                className="sv-aba"
                aria-selected={aba === 'ao-vivo'}
                aria-controls={painelDaAbaId}
                tabIndex={aba === 'ao-vivo' ? 0 : -1}
                onClick={() => mudarAba('ao-vivo')}
                onKeyDown={aoTeclarNaAba}
              >
                Ao vivo
              </button>
              <button
                id={abaEncerradosId}
                type="button"
                role="tab"
                className="sv-aba"
                aria-selected={aba === 'encerrados'}
                aria-controls={painelDaAbaId}
                tabIndex={aba === 'encerrados' ? 0 : -1}
                onClick={() => mudarAba('encerrados')}
                onKeyDown={aoTeclarNaAba}
              >
                Últimas 24 h
              </button>
            </div>
          </div>
          {erroDaBusca && <p id={erroDaBuscaId} role="alert" className="sv-erro-da-busca">{erroDaBusca}</p>}
          {erroAoAbrir && <p role="alert" className="sv-erro-da-busca">{erroAoAbrir}</p>}
          <ChipsDosFiltros chips={chips} onRemover={removerFiltro} onLimpar={limparFiltros} />

          {aba === 'ao-vivo' && !resultadoTelefone && (
            <IndicadoresDaSupervisao
              espera={dadosVisiveis ? esperaFiltrada.length : null}
              atendimento={dadosVisiveis ? atendimentoFiltrado.length : null}
              automacao={dadosVisiveis ? automacaoFiltrada.length : null}
              online={dadosVisiveis ? totalOnline : null}
              visao={visao}
              onVisao={alternarVisao}
              onEquipe={irParaEquipe}
            />
          )}

          <div className="sv-corpo">
            <div
              id={painelDaAbaId}
              role="tabpanel"
              aria-labelledby={aba === 'ao-vivo' ? abaAoVivoId : abaEncerradosId}
              className="sv-principal"
              onPointerEnter={precarregarPopup}
              onFocus={precarregarPopup}
            >
              {resultadoTelefone ? (
                <ResultadoDoTelefone resultado={resultadoTelefone} rotulos={rotulos} onAbrir={abrirConversa} onLimpar={limparBusca} />
              ) : aba === 'ao-vivo' ? (
                <ListaDaSupervisao
                  estado={estadoDaLista}
                  grupos={grupos}
                  visao={visao}
                  total={totalVisivel}
                  sufixoDoVazio={sufixoDoVazio(temFiltro, Boolean(busca))}
                  rotulos={rotulos}
                  onAbrir={abrirConversa}
                  onTentarDeNovo={recarregarPainel}
                />
              ) : (
                <EncerradosDaSupervisao
                  visiveis={encerradosVisiveis}
                  carregado={encerrados.carregado}
                  erro={erroEncerrados}
                  temMais={encerrados.temMais}
                  carregandoMais={carregandoMais}
                  contagem={contagemDeEncerrados}
                  aviso={avisoDeEncerrados}
                  vazio={`Nenhuma conversa encerrada nas últimas 24 h${sufixoDoVazio(temFiltro, Boolean(busca))}`}
                  rotulos={rotulos}
                  onAbrir={abrirConversa}
                  onCarregarMais={carregarMais}
                  onTentarDeNovo={tentarEncerradosDeNovo}
                />
              )}
            </div>
            <EquipeLateral {...propsDaEquipe} />
          </div>
        </div>

        {folhaAberta && <FolhaDaEquipe {...propsDaEquipe} onFechar={fecharFolha} />}
        {conversaDoPopup && Popup && (
          <Popup
            conversation={conversaDoPopup}
            onClose={fecharConversa}
            onTransferClick={setTransferindoId}
            onContatoSalvo={aoSalvarContato}
          />
        )}
        {transferindoId && Transferencia && <Transferencia conversationId={transferindoId} onClose={fecharTransferencia} />}
      </div>

      {/* Trilho e ícone do botão "Abrir menu" vão para os encaixes que a casca
          reserva (AppShell.jsx), como na mesa. Fora da casca (testes), não há
          encaixe. */}
      {encaixeDoTrilho && createPortal(
        <TrilhoDaMesa onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} profileVersion={profileVersion} />,
        encaixeDoTrilho
      )}
      {encaixeDoIcone && createPortal(<IconeDoMenu />, encaixeDoIcone)}
    </RelogioDaSupervisao>
  );
}

export default SupervisionPage;
