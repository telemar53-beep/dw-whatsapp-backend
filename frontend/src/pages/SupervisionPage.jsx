import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import {
  getDashboardClosedToday,
  getDashboardConversationByProtocol,
  getDashboardConversationsByPhone,
  closeConversation,
} from '../services/api';
import ConversationListItem from '../components/ConversationListItem';
import { usePresence } from '../hooks/usePresence';
import './supervision.css';
import ConversationModal from '../components/ConversationModal';
import TransferModal from '../components/TransferModal';
import { PageHeader, Tabs } from '../components/ui';
import { descreverErro } from '../utils/errorMessages';
import { shortenAgentNames, agentInitial } from '../utils/agentDisplayName';

// O estado é o sinal mais alto desta tela: cada um tem um tom próprio que
// aparece no mesmo lugar em todo canto — ponto do sub-filtro, cabeçalho do
// grupo, aresta da linha. Roxo é o tom que o produto já usa para IA.
const TONS = { andamento: 'andamento', espera: 'espera', automacao: 'automacao', encerrado: 'encerrado' };

function estadoDaConversa(conversation) {
  if (conversation.status === 'closed') return { tom: TONS.encerrado, rotulo: 'Encerrado' };
  if (conversation.status === 'assigned') return { tom: TONS.andamento, rotulo: 'Em atendimento' };
  if (conversation.triageState === 'pending') return { tom: TONS.automacao, rotulo: 'Em automação' };
  return { tom: TONS.espera, rotulo: 'Em espera' };
}

const CLOSED_PAGE_SIZE = 20;

// Valor sintético no filtro de Atendentes: a IA não é um agente, mas o admin
// precisa ver o que ela atendeu — encerrou sozinha (boleto/PIX entregue e
// cliente satisfeito), concluiu para uma fila, ou ainda está triando.
export const AI_AGENT_FILTER = 'ai';

export function isHandledByAi(conversation) {
  if (conversation.assignedAgentId) return false;
  return Boolean(
    conversation.aiTriageResolvedByAi
    || conversation.aiTriageCompletedAt
    || conversation.triageState === 'pending'
  );
}

function matchesFilters(conversation, { channelIds, agentIds, sectorIds }) {
  if (channelIds.length > 0 && !channelIds.includes(conversation.channelId)) return false;
  if (agentIds.length > 0) {
    const porAgente = agentIds.includes(conversation.assignedAgentId);
    const porIa = agentIds.includes(AI_AGENT_FILTER) && isHandledByAi(conversation);
    if (!porAgente && !porIa) return false;
  }
  if (sectorIds.length > 0 && !sectorIds.includes(conversation.sectorId)) return false;
  return true;
}

function FilterDropdown({ label, options, selected, onToggle, open, onOpenChange }) {
  const containerRef = useRef(null);
  const gatilho = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onOpenChange(false);
      }
    }
    // Só havia listener de `mousedown`: pelo teclado o painel abria e não havia
    // NENHUMA forma de fechá-lo — ESC não fazia nada e o Tab saía deixando os
    // filtros abertos por cima da lista.
    function onKey(event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onOpenChange(false);
      gatilho.current?.focus();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={gatilho}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="h-[38px] shrink-0 rounded-[10px] border border-white/[0.12] bg-ui-surface-field px-4 text-[14px] text-chat-muted transition hover:border-white/25 hover:bg-white/[0.10] hover:text-chat-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {label}
        {selected.length > 0 && <span className="ml-1.5 font-medium text-chat-orange">{selected.length}</span>}
        <svg className="supervision-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="dialog-filter-options chat-scroll absolute z-[var(--z-popover)] mt-2 max-h-64 w-56 overflow-y-auto rounded-[16px] border border-white/[0.10] bg-wa-panel p-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[13px] text-wa-muted">Nenhuma opção</p>
          ) : (
            options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-[13.5px] text-chat-muted hover:bg-white/[0.07] hover:text-chat-text">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} className="h-4 w-4 shrink-0 accent-chat-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DashboardColumn({ title, count, conversations, onSelect, onQuickClose, emptyMessage, tom }) {
  return <section className="supervision-group" data-tom={tom}>
    {/* O cabeçalho gruda no topo ao rolar: numa lista longa o supervisor
        perdia de vista em que fila estava. */}
    <div className="supervision-group-heading"><h2>{title}</h2><span>{count}</span></div>
    {conversations.length === 0 ? <p className="supervision-empty">{emptyMessage}</p> :
      <ul>{conversations.map(conversation => <SupervisionRow key={conversation.id} conversation={conversation} onSelect={onSelect} onQuickClose={onQuickClose} stateLabel={title} tom={tom} />)}</ul>}
  </section>;
}

// Primeiro nome do responsável: a coluna compara dezenas de linhas e o nome
// inteiro roubava a largura de tudo. O título preserva o nome completo.
function primeiroNome(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  if (partes[0].length <= 2 && partes[1]) return `${partes[0]} ${partes[1]}`;
  return partes[0];
}

function SupervisionRow({ conversation, onSelect, onQuickClose, stateLabel, tom }) {
  const date = conversation.closedAt || conversation.lastMessageAt || conversation.createdAt;
  const estado = estadoDaConversa(conversation);
  const dono = conversation.assignedAgentName;
  // Mesmo desempate do painel lateral quando ele existe; fora dele (IA, busca
  // por telefone) cai para o primeiro nome.
  const donoCurto = conversation.assignedAgentShortName || primeiroNome(dono);
  const origem = conversation.closedAt ? 'Encerramento' : conversation.lastMessageAt ? 'Última mensagem' : conversation.createdAt ? 'Abertura' : '';
  return <li className="supervision-record" data-tom={tom || estado.tom}>
    <div className="supervision-record-contact"><ul><ConversationListItem conversation={{ ...conversation, contactCityName: null, sectorName: null, assignedAgentName: null }} onSelect={onSelect} compact onQuickClose={onQuickClose} /></ul></div>
    <div className="supervision-record-location">
      <span className={conversation.contactCityName ? '' : 'is-ausente'}>{conversation.contactCityName || 'Cidade não informada'}</span>
      <small className={conversation.sectorName ? '' : 'is-ausente'}>{conversation.sectorName || 'Sem setor'}</small>
    </div>
    <div className="supervision-record-owner">
      {dono
        ? <span className="supervision-owner" title={dono}><i aria-hidden="true">{agentInitial(donoCurto)}</i>{donoCurto}</span>
        : <span className="supervision-owner is-ausente"><i aria-hidden="true" data-vazio="true" />Sem responsável</span>}
    </div>
    {/* Dentro de um grupo o estado já está no cabeçalho — repeti-lo em cada
        linha era ruído. Fora dele (encerrados, busca por telefone) a linha é
        a única a dizer o estado, então a pastilha aparece. */}
    <div className="supervision-record-state">
      {!stateLabel && <span className="supervision-state-pill"><i aria-hidden="true" />{estado.rotulo}</span>}
      <time dateTime={date || undefined}>{date ? new Date(date).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Horário não informado'}</time>
      <small>{origem}</small>
    </div>
    <button type="button" className="supervision-open" onClick={() => onSelect(conversation.id)} aria-label={'Abrir conversa de ' + (conversation.contactDisplayName || conversation.contactPhoneNumber || 'cliente')}>Abrir</button>
  </li>;
}

function SupervisionPage() {
  const { token } = useAuth();
  // O hook já expunha `status` e `refresh`; a página ignorava os dois e, com a
  // API fora do ar, as três colunas diziam "nenhum atendimento" — operação
  // parada e backend caído ficavam idênticos na tela.
  const { inProgress, waiting, inAutomation, closedTodayCount, status: dashboardStatus, refresh: refreshDashboard } = useAttendanceDashboard();
  // Esconder os dados é a exceção, não a regra: só quando se sabe que está
  // carregando ou que falhou. Assim um status ausente mostra a operação em vez
  // de uma tela vazia — o erro que esta correção existe para acabar.
  const dashboardDataVisible = dashboardStatus !== 'loading' && dashboardStatus !== 'error' && dashboardStatus !== 'forbidden';
  // `0` significa "o sistema carregou e confirmou que nao ha nenhum".
  // Quando a requisicao nao respondeu, o numero nao e confiavel e vira `—`:
  // erro nao pode se passar por operacao vazia.
  const numero = (valor) => (dashboardDataVisible ? valor : '—');
  const { channels } = useChannels(true);
  const { agents, status: agentsStatus } = useAgents();
  const onlineIds = usePresence(agents);
  const [operationView, setOperationView] = useState('all');
  const { sectors } = useSectors();

  const [searchParams, setSearchParams] = useSearchParams();
  const channelFilter = searchParams.getAll('canal');
  const agentFilter = searchParams.getAll('atendente');
  const sectorFilter = searchParams.getAll('setor');
  const activeTab = searchParams.get('aba') === 'encerrados' ? 'closed' : 'all';

  function setFilterParam(key, values) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(key);
      values.forEach((v) => next.append(key, v));
      return next;
    }, { replace: true });
  }
  function toggleFilterValue(key, current, value) {
    setFilterParam(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  }
  // Limpa só os três filtros. A aba ativa e qualquer outro parâmetro da URL
  // continuam onde estavam.
  function limparFiltros() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('canal');
      next.delete('atendente');
      next.delete('setor');
      return next;
    }, { replace: true });
  }
  function setActiveTab(tab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'closed') next.set('aba', 'encerrados'); else next.delete('aba');
      return next;
    }, { replace: true });
  }

  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);

  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name || a.email])),
    [agents]
  );

  const [openFilterMenu, setOpenFilterMenu] = useState(null);

  const [closedItems, setClosedItems] = useState([]);
  const [closedOffset, setClosedOffset] = useState(0);
  const [closedHasMore, setClosedHasMore] = useState(false);
  const [loadingClosed, setLoadingClosed] = useState(false);

  const [protocolQuery, setProtocolQuery] = useState('');
  const [protocolError, setProtocolError] = useState(null);
  const [foundConversation, setFoundConversation] = useState(null);

  const [phoneQuery, setPhoneQuery] = useState('');
  const [phoneError, setPhoneError] = useState(null);
  const [phoneSearchResult, setPhoneSearchResult] = useState(null);
  const [closedError, setClosedError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [closedReloadToken, setClosedReloadToken] = useState(0);

  useEffect(() => {
    if (!token) return;
    setClosedError(null);
    getDashboardClosedToday({ offset: 0, limit: CLOSED_PAGE_SIZE }, token)
      .then((data) => {
        setClosedItems(data.items);
        setClosedOffset(data.items.length);
        setClosedHasMore(data.hasMore);
      })
      // O erro guarda o ESCOPO porque "Tentar de novo" precisa repetir a
      // requisição certa: recarregar a primeira página joga fora o que já
      // estava na tela, e isso não pode acontecer por causa de uma falha numa
      // página adicional.
      .catch(() => setClosedError({ mensagem: 'Não foi possível carregar os atendimentos encerrados hoje.', escopo: 'inicial' }));
  }, [token, closedReloadToken]);

  function loadMoreClosed() {
    setLoadingClosed(true);
    setClosedError(null);
    getDashboardClosedToday({ offset: closedOffset, limit: CLOSED_PAGE_SIZE }, token)
      .then((data) => {
        setClosedItems((prev) => [...prev, ...data.items]);
        setClosedOffset((prev) => prev + data.items.length);
        setClosedHasMore(data.hasMore);
        setLoadingClosed(false);
      })
      .catch(() => {
        setLoadingClosed(false);
        // A lista já carregada continua intacta de propósito: falhar a próxima
        // página não invalida os encerrados que já estão na tela.
        setClosedError({ mensagem: 'Não foi possível carregar mais atendimentos encerrados.', escopo: 'mais' });
      });
  }

  function tentarEncerradosDeNovo() {
    if (closedError && closedError.escopo === 'mais') {
      loadMoreClosed();
      return;
    }
    setClosedReloadToken((n) => n + 1);
  }

  const filters = useMemo(
    () => ({ channelIds: channelFilter, agentIds: agentFilter, sectorIds: sectorFilter }),
    [channelFilter, agentFilter, sectorFilter]
  );

  const hasActiveFilter = channelFilter.length > 0 || agentFilter.length > 0 || sectorFilter.length > 0;

  const filteredInProgress = inProgress.filter((c) => matchesFilters(c, filters));
  const filteredWaiting = waiting.filter((c) => matchesFilters(c, filters));
  const filteredInAutomation = inAutomation.filter((c) => matchesFilters(c, filters));
  const filteredClosed = closedItems.filter((c) => matchesFilters(c, filters));

  // A carga da equipe vem do painel NÃO filtrado, de propósito: filtrar a tela
  // não muda quantos atendimentos o atendente tem de verdade. Contado uma vez,
  // em vez de varrer `inProgress` por atendente dentro do map.
  const cargaPorAtendente = useMemo(() => {
    const mapa = new Map();
    for (const conversa of inProgress) {
      if (!conversa.assignedAgentId) continue;
      mapa.set(conversa.assignedAgentId, (mapa.get(conversa.assignedAgentId) || 0) + 1);
    }
    return mapa;
  }, [inProgress]);
  const cargaMaxima = useMemo(
    () => Math.max(1, ...agents.map((a) => cargaPorAtendente.get(a.id) || 0)),
    [agents, cargaPorAtendente]
  );

  // O painel é operacional: quem está com mais carga sobe, e quem está offline
  // desce — é a ordem em que o supervisor precisa ler. Empate desempata pelo
  // rótulo que está na tela, não pelo nome inteiro.
  const equipe = useMemo(() => {
    const rotulos = shortenAgentNames(agents.map((a) => a.name || a.email));
    return agents
      .map((agent, i) => ({
        agent,
        rotulo: rotulos[i],
        carga: cargaPorAtendente.get(agent.id) || 0,
        online: onlineIds.has(agent.id),
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.carga - a.carga || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }, [agents, cargaPorAtendente, onlineIds]);
  const totalOnline = equipe.filter((e) => e.online).length;
  const rotuloCurtoPorAgente = useMemo(
    () => new Map(equipe.map(({ agent, rotulo }) => [agent.id, rotulo])),
    [equipe]
  );

  function withAgentName(conversation) {
    const agentName = conversation.assignedAgentId ? agentNameById[conversation.assignedAgentId] : null;
    if (agentName) return { ...conversation, assignedAgentName: agentName, assignedAgentShortName: rotuloCurtoPorAgente.get(conversation.assignedAgentId) };
    // Encerrado pela própria IA: aparece como "IA" onde o atendente apareceria.
    if (conversation.status === 'closed' && isHandledByAi(conversation)) return { ...conversation, assignedAgentName: 'IA' };
    return conversation;
  }

  const displayInProgress = filteredInProgress.map(withAgentName);
  const displayWaiting = filteredWaiting.map(withAgentName);
  const displayInAutomation = filteredInAutomation.map(withAgentName);
  const displayClosed = filteredClosed.map(withAgentName);

  const totalActiveCount = filteredInProgress.length + filteredWaiting.length + filteredInAutomation.length;
  const closedCount = hasActiveFilter ? filteredClosed.length : closedTodayCount;
  // Com filtro, o número só pode sair da lista JÁ CARREGADA — o endpoint de
  // encerrados não aceita filtro nem devolve total filtrado. Enquanto houver
  // páginas por vir, esse número não é o total: 5 correspondências entre os 20
  // primeiros não dizem nada sobre a existência de uma sexta. Então ele se
  // apresenta como parcial em vez de se passar por total.
  const contagemParcialDeEncerrados = hasActiveFilter && closedHasMore;


  // Fila realmente vazia e fila escondida por filtro diziam a mesma frase.
  const vazioDaColuna = (texto) => (hasActiveFilter ? `${texto} com os filtros atuais.` : `${texto}.`);

  // Quantas linhas a visão atual realmente desenha — é o que decide se os
  // rótulos de coluna têm o que rotular.
  const linhasVisiveis = dashboardDataVisible
    ? (operationView === 'all' || operationView === 'progress' ? filteredInProgress.length : 0)
      + (operationView === 'all' || operationView === 'waiting' ? filteredWaiting.length : 0)
      + (operationView === 'all' || operationView === 'automation' ? filteredInAutomation.length : 0)
    : 0;

  function contagemDaAbaEncerrados() {
    if (!hasActiveFilter) return numero(closedCount);
    if (closedError) return '—';
    if (contagemParcialDeEncerrados) {
      return <span className="supervision-contagem-parcial"><b>{closedCount}</b> carregados</span>;
    }
    // Sem mais páginas, tudo que existe já está na memória: o filtrado é total.
    return closedCount;
  }

  function openConversation(conversationId) {
    setSelectedConversationId(conversationId);
  }

  function quickCloseConversation(conversationId) {
    setActionError(null);
    // Antes falhava calado: o supervisor clicava em finalizar e nada acontecia.
    closeConversation(conversationId, null, token).catch((err) =>
      setActionError(descreverErro(err, 'Não foi possível finalizar este atendimento.'))
    );
  }

  async function handleProtocolSearch(event) {
    event.preventDefault();
    setProtocolError(null);
    const query = protocolQuery.trim();
    if (!query) return;
    try {
      const conversation = await getDashboardConversationByProtocol(query, token);
      setFoundConversation(conversation);
      setSelectedConversationId(conversation.id);
    } catch (err) {
      setFoundConversation(null);
      setProtocolError(descreverErro(err, 'Nenhum atendimento encontrado com esse protocolo'));
    }
  }

  async function handlePhoneSearch(event) {
    event.preventDefault();
    setPhoneError(null);
    const query = phoneQuery.trim();
    if (!query) return;
    try {
      const result = await getDashboardConversationsByPhone(query, token);
      setPhoneSearchResult(result);
    } catch (err) {
      setPhoneSearchResult(null);
      setPhoneError(descreverErro(err, 'Nenhum cliente encontrado com esse telefone'));
    }
  }

  function clearPhoneSearch() {
    setPhoneSearchResult(null);
    setPhoneQuery('');
    setPhoneError(null);
  }

  const selectedConversation =
    [...inProgress, ...waiting, ...inAutomation, ...closedItems].find((c) => c.id === selectedConversationId) ||
    (foundConversation && foundConversation.id === selectedConversationId ? foundConversation : null) ||
    (phoneSearchResult && phoneSearchResult.conversations.find((c) => c.id === selectedConversationId)) ||
    null;

  return (
    <div className="supervision-workspace flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title="Supervisão" description="Central de operação · equipe, carga e atendimentos" />

      <div className="supervision-toolbar flex shrink-0 flex-col gap-3 border-y border-white/[0.07] bg-white/[0.025] px-4 py-3 xl:flex-row xl:items-center">
        <Tabs
          label="Atendimentos"
          active={activeTab}
          onChange={setActiveTab}
          tabs={[
            { key: 'all', label: 'Todos atendimentos', count: numero(totalActiveCount) },
            // Com filtro o numero vem da lista de encerrados (outra requisicao);
            // sem filtro vem do painel. Cada um responde pela propria falha.
            { key: 'closed', label: 'Encerrados hoje', count: contagemDaAbaEncerrados() },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
        <FilterDropdown
          label="Canais"
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
          selected={channelFilter}
          onToggle={(value) => toggleFilterValue('canal', channelFilter, value)}
          open={openFilterMenu === 'channels'}
          onOpenChange={(next) => setOpenFilterMenu(next ? 'channels' : null)}
        />
        <FilterDropdown
          label="Atendentes"
          options={[{ value: AI_AGENT_FILTER, label: 'IA' }, ...agents.map((a) => ({ value: a.id, label: a.name || a.email }))]}
          selected={agentFilter}
          onToggle={(value) => toggleFilterValue('atendente', agentFilter, value)}
          open={openFilterMenu === 'agents'}
          onOpenChange={(next) => setOpenFilterMenu(next ? 'agents' : null)}
        />
        <FilterDropdown
          label="Setores"
          options={sectors.map((s) => ({ value: s.id, label: s.name }))}
          selected={sectorFilter}
          onToggle={(value) => toggleFilterValue('setor', sectorFilter, value)}
          open={openFilterMenu === 'sectors'}
          onOpenChange={(next) => setOpenFilterMenu(next ? 'sectors' : null)}
        />
        {hasActiveFilter && (
          <button
            type="button"
            onClick={limparFiltros}
            className="h-[38px] shrink-0 rounded-[10px] px-3 text-[14px] font-medium text-chat-orange transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Limpar filtros
          </button>
        )}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-white/10 max-xl:hidden" />
        <form onSubmit={handleProtocolSearch} className="min-w-0 max-w-full shrink-0">
          <input
            type="text"
            value={protocolQuery}
            onChange={(e) => setProtocolQuery(e.target.value)}
            placeholder="Buscar por protocolo"
            aria-label="Buscar por protocolo"
            className="h-[38px] w-[205px] max-w-full rounded-[10px] border border-white/[0.12] bg-ui-surface-field px-4 text-[14px] text-chat-text outline-none transition placeholder:text-chat-muted focus-visible:border-white/25"
          />
        </form>
        <form onSubmit={handlePhoneSearch} className="min-w-0 max-w-full shrink-0">
          <input
            type="text"
            value={phoneQuery}
            onChange={(e) => setPhoneQuery(e.target.value)}
            placeholder="Buscar por telefone do cliente"
            aria-label="Buscar por telefone do cliente"
            className="h-[38px] w-[262px] max-w-full rounded-[10px] border border-white/[0.12] bg-ui-surface-field px-4 text-[14px] text-chat-text outline-none transition placeholder:text-chat-muted focus-visible:border-white/25"
          />
        </form>
        </div>
      </div>
      {(protocolError || phoneError || actionError) && (
        <p role="alert" className="px-2 pb-2 text-[13px] text-wa-error-text">{protocolError || phoneError || actionError}</p>
      )}

      <div className="supervision-central">
        <aside className="supervision-team" aria-label="Equipe e carga">
          <header>
            <h2>Equipe e carga</h2>
            <span className="supervision-online-chip"><i aria-hidden="true" />{numero(totalOnline)} online</span>
          </header>
          <p>Atendimentos ativos por atendente · clique para filtrar</p>
          {agentsStatus === 'loading' && <p role="status">Carregando equipe…</p>}
          {agentsStatus === 'error' && <p role="alert">Não foi possível carregar a equipe.</p>}
          <ul>{equipe.map(({ agent, rotulo, carga, online }) => (
            <li key={agent.id}>
              <button type="button" data-online={online ? 'true' : 'false'} aria-pressed={agentFilter.includes(agent.id)} onClick={() => toggleFilterValue('atendente', agentFilter, agent.id)}>
                <span className="supervision-agent-avatar" aria-hidden="true">{agentInitial(rotulo)}</span>
                <span className="supervision-agent-name" title={agent.name || agent.email}>{rotulo}</span>
                {/* A carga vem da mesma requisicao do painel: sem ela, nao da
                    para afirmar que o atendente esta sem atendimentos. */}
                <strong title="Atendimentos ativos" data-zero={dashboardDataVisible && carga === 0 ? 'true' : undefined}>{numero(carga)}<small className="sr-only"> atendimentos ativos</small></strong>
                {/* A presença é dita por extenso: o ponto verde é reforço, nunca o
                    único canal — quem não distingue a cor precisa ler o estado. */}
                <span className="supervision-presence">
                  <i className={online ? 'is-online' : ''} />
                  {online ? 'Online' : 'Offline'}
                  {/* A atividade é o detalhe que cede primeiro quando o painel
                      estreita; a presença em si nunca some. */}
                  {online && dashboardDataVisible && <em>{carga ? 'Em atendimento' : 'Livre'}</em>}
                </span>
                <span className="supervision-load" data-zero={dashboardDataVisible && carga === 0 ? 'true' : undefined} aria-hidden="true"><span style={{width: (dashboardDataVisible && cargaMaxima ? carga / cargaMaxima * 100 : 0) + '%'}} /></span>
              </button>
            </li>
          ))}</ul>
          {agentsStatus === 'ready' && agents.length === 0 && <p>Nenhum atendente cadastrado.</p>}
        </aside>
        <main className="supervision-operation" aria-label="Operação">
          {/* "Visão geral" repetia, encostado, o mesmo número da aba "Todos
              atendimentos". Os outros três somam para ele, então esses ficam. */}
          {!phoneSearchResult && activeTab === 'all' && <nav className="supervision-states" aria-label="Estados dos atendimentos">
            {[['all','Visão geral',null,null],['progress','Andamento',filteredInProgress.length,TONS.andamento],['waiting','Espera',filteredWaiting.length,TONS.espera],['automation','Automação',filteredInAutomation.length,TONS.automacao]].map(([key,label,count,tom]) => <button type="button" key={key} data-tom={tom || undefined} aria-pressed={operationView === key} onClick={() => setOperationView(key)}>{tom && <i aria-hidden="true" />}{label}{count !== null && <strong>{numero(count)}</strong>}</button>)}
          </nav>}
      {phoneSearchResult ? (
        <div role="tabpanel" className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-[14px] text-chat-muted">
              {phoneSearchResult.conversations.length} atendimento(s) de{' '}
              {phoneSearchResult.contact.displayName || phoneSearchResult.contact.phoneNumber}
            </p>
            <button
              type="button"
              onClick={clearPhoneSearch}
              className="shrink-0 rounded-[8px] text-[13px] font-medium text-chat-orange hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Limpar busca
            </button>
          </div>
          {phoneSearchResult.conversations.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13.5px] text-chat-muted">Esse cliente ainda não teve nenhum atendimento.</p>
          ) : (
            <ul>
              {phoneSearchResult.conversations.map(withAgentName).map((conversation) => (
                <SupervisionRow
                  key={conversation.id}
                  conversation={conversation}
                  onSelect={openConversation}
                />
              ))}
            </ul>
          )}
        </div>
      ) : activeTab === 'all' ? (
        <div id="tabpanel-all" role="tabpanel" aria-labelledby="tab-all" className="supervision-live chat-scroll">
          {dashboardStatus === 'loading' && (
            <p role="status" className="px-4 py-10 text-center text-[13.5px] text-chat-muted">Carregando atendimentos…</p>
          )}
          {dashboardStatus === 'forbidden' && (
            <p role="alert" className="px-4 py-10 text-center text-[13.5px] text-wa-error-text">Você não tem acesso ao painel de atendimentos.</p>
          )}
          {dashboardStatus === 'error' && (
            <div role="alert" className="flex flex-wrap items-center justify-center gap-3 px-4 py-10 text-center text-[13.5px] text-wa-error-text">
              <span>Não foi possível carregar os atendimentos.</span>
              <button
                type="button"
                onClick={refreshDashboard}
                className="rounded-[8px] border border-wa-error-text/40 px-2.5 py-1 text-[13px] font-medium transition hover:bg-wa-error-text/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Tentar de novo
              </button>
            </div>
          )}
          {/* Os rótulos descrevem as colunas das linhas: só existem quando há
              linha. Antes pairavam sobre o carregando, o erro, a busca por
              telefone, os encerrados e as listas vazias. */}
          {linhasVisiveis > 0 && (
            <div className="supervision-column-labels" aria-hidden="true"><span>Cliente / última mensagem</span><span>Cidade / setor</span><span>Responsável</span><span>Horário</span><span /></div>
          )}
          {dashboardDataVisible && (operationView === 'all' || operationView === 'progress') && (          <DashboardColumn
            title="Em andamento"
            tom={TONS.andamento}
            count={filteredInProgress.length}
            conversations={displayInProgress}
            onSelect={openConversation}
            emptyMessage={vazioDaColuna('Nenhum atendimento em andamento')}
          />)}
          {dashboardDataVisible && (operationView === 'all' || operationView === 'waiting') && (          <DashboardColumn
            title="Em espera"
            tom={TONS.espera}
            count={filteredWaiting.length}
            conversations={displayWaiting}
            onSelect={openConversation}
            onQuickClose={quickCloseConversation}
            emptyMessage={vazioDaColuna('Nenhum atendimento em espera')}
          />)}
          {dashboardDataVisible && (operationView === 'all' || operationView === 'automation') && (          <DashboardColumn
            title="Em automação"
            tom={TONS.automacao}
            count={filteredInAutomation.length}
            conversations={displayInAutomation}
            onSelect={openConversation}
            onQuickClose={quickCloseConversation}
            emptyMessage={vazioDaColuna('Nenhum atendimento em automação')}
          />)}
        </div>
      ) : (
        <div id="tabpanel-closed" role="tabpanel" aria-labelledby="tab-closed" className="supervision-live chat-scroll">
          {/* Falha e fila vazia diziam a mesma coisa: "Nenhum atendimento
              encerrado hoje.". O erro agora fala por si, e o que já estava
              carregado continua na tela embaixo dele. */}
          {closedError && (
            <div role="alert" className="supervision-closed-error">
              <span>{closedError.mensagem}</span>
              <button type="button" onClick={tentarEncerradosDeNovo}>Tentar de novo</button>
            </div>
          )}
          {hasActiveFilter && closedItems.length > 0 && (
            <p className="supervision-parcial-aviso">
              {contagemParcialDeEncerrados
                ? `${filteredClosed.length} ${filteredClosed.length === 1 ? 'correspondência' : 'correspondências'} entre ${closedItems.length} encerrados carregados. Há mais resultados disponíveis — use “Carregar mais”.`
                : `${filteredClosed.length} de ${closedItems.length} encerrados de hoje correspondem aos filtros.`}
            </p>
          )}
          {displayClosed.length > 0 && (
            <div className="supervision-column-labels" aria-hidden="true"><span>Cliente / última mensagem</span><span>Cidade / setor</span><span>Responsável</span><span>Estado / horário</span><span /></div>
          )}
          {displayClosed.length === 0 ? (
            closedError ? null : (
            <p className="supervision-vazio-central">
              {hasActiveFilter ? 'Nenhum atendimento encerrado hoje com os filtros atuais.' : 'Nenhum atendimento encerrado hoje.'}
            </p>
            )
          ) : (
            <ul>
              {displayClosed.map((conversation) => (
                <SupervisionRow
                  key={conversation.id}
                  conversation={conversation}
                  onSelect={openConversation}
                />
              ))}
            </ul>
          )}
          {closedHasMore && (
            <button
              type="button"
              onClick={loadMoreClosed}
              disabled={loadingClosed}
              className="supervision-carregar-mais"
            >
              {loadingClosed ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}
        </main>
      </div>
      {selectedConversation && (
        <ConversationModal
          conversation={withAgentName(selectedConversation)}
          onClose={() => setSelectedConversationId(null)}
          onTransferClick={setTransferringId}
        />
      )}
      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
    </div>
  );
}

export default SupervisionPage;
