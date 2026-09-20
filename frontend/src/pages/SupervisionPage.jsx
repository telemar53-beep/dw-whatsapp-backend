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

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onOpenChange(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="h-[38px] shrink-0 rounded-[10px] border border-white/[0.12] bg-[#354047] px-4 text-[14px] text-chat-muted transition hover:border-white/25 hover:bg-white/[0.10] hover:text-chat-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {label}
        {selected.length > 0 && <span className="ml-1.5 font-medium text-chat-orange">{selected.length}</span>}
      </button>
      {open && (
        <div className="dialog-filter-options chat-scroll absolute z-10 mt-2 max-h-64 w-56 overflow-y-auto rounded-[16px] border border-white/[0.10] bg-wa-panel p-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl">
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

function DashboardColumn({ title, count, conversations, onSelect, onQuickClose, emptyMessage }) {
  return <section className="supervision-group">
    <div className="supervision-group-heading"><h2>{title}</h2><span>{count}</span></div>
    {conversations.length === 0 ? <p className="supervision-empty">{emptyMessage}</p> :
      <ul>{conversations.map(conversation => <SupervisionRow key={conversation.id} conversation={conversation} onSelect={onSelect} onQuickClose={onQuickClose} stateLabel={title} />)}</ul>}
  </section>;
}

function SupervisionRow({ conversation, onSelect, onQuickClose, stateLabel }) {
  const date = conversation.closedAt || conversation.lastMessageAt || conversation.createdAt;
  return <li className="supervision-record">
    <div className="supervision-record-contact"><ul><ConversationListItem conversation={{ ...conversation, contactCityName: null, sectorName: null, assignedAgentName: null }} onSelect={onSelect} compact onQuickClose={onQuickClose} /></ul></div>
    <div className="supervision-record-location"><span>{conversation.contactCityName || 'Cidade não informada'}</span><small>{conversation.sectorName || 'Sem setor'}</small></div>
    <div className="supervision-record-owner">{conversation.assignedAgentName || 'Sem responsável'}</div>
    <div className="supervision-record-state"><span>{stateLabel || (conversation.status === 'closed' ? 'Encerrado' : conversation.status === 'assigned' ? 'Em atendimento' : conversation.triageState === 'pending' ? 'Em automação' : 'Em espera')}</span><small>{date ? new Date(date).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Horário não informado'}</small><small>{conversation.closedAt ? 'Encerramento' : conversation.lastMessageAt ? 'Última mensagem' : conversation.createdAt ? 'Abertura' : ''}</small></div>
    <button type="button" className="supervision-open" onClick={() => onSelect(conversation.id)} aria-label={'Abrir conversa de ' + (conversation.contactDisplayName || conversation.contactPhoneNumber || 'cliente')}>Abrir →</button>
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
      .catch(() => setClosedError('Não foi possível carregar os atendimentos encerrados hoje.'));
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
        setClosedError('Não foi possível carregar mais atendimentos encerrados.');
      });
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

  function withAgentName(conversation) {
    const agentName = conversation.assignedAgentId ? agentNameById[conversation.assignedAgentId] : null;
    if (agentName) return { ...conversation, assignedAgentName: agentName };
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

  function openConversation(conversationId) {
    setSelectedConversationId(conversationId);
  }

  function quickCloseConversation(conversationId) {
    setActionError(null);
    // Antes falhava calado: o supervisor clicava em finalizar e nada acontecia.
    closeConversation(conversationId, null, token).catch((err) =>
      setActionError((err && err.body && err.body.error) || 'Não foi possível finalizar este atendimento.')
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
      setProtocolError((err.body && err.body.error) || 'Nenhum atendimento encontrado com esse protocolo');
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
      setPhoneError((err.body && err.body.error) || 'Nenhum cliente encontrado com esse telefone');
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
            { key: 'closed', label: 'Encerrados hoje', count: hasActiveFilter ? (closedError ? '—' : closedCount) : numero(closedCount) },
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
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-white/10 max-xl:hidden" />
        <form onSubmit={handleProtocolSearch} className="min-w-0 max-w-full shrink-0">
          <input
            type="text"
            value={protocolQuery}
            onChange={(e) => setProtocolQuery(e.target.value)}
            placeholder="Buscar por protocolo"
            aria-label="Buscar por protocolo"
            className="h-[38px] w-[205px] max-w-full rounded-[10px] border border-white/[0.12] bg-[#354047] px-4 text-[14px] text-chat-text outline-none transition placeholder:text-chat-muted focus-visible:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
        </form>
        <form onSubmit={handlePhoneSearch} className="min-w-0 max-w-full shrink-0">
          <input
            type="text"
            value={phoneQuery}
            onChange={(e) => setPhoneQuery(e.target.value)}
            placeholder="Buscar por telefone do cliente"
            aria-label="Buscar por telefone do cliente"
            className="h-[38px] w-[262px] max-w-full rounded-[10px] border border-white/[0.12] bg-[#354047] px-4 text-[14px] text-chat-text outline-none transition placeholder:text-chat-muted focus-visible:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
        </form>
        </div>
      </div>
      {(protocolError || phoneError || actionError) && (
        <p role="alert" className="px-2 pb-2 text-[13px] text-wa-error-text">{protocolError || phoneError || actionError}</p>
      )}

      <div className="supervision-central">
        <aside className="supervision-team" aria-label="Equipe e carga">
          <header><h2>Equipe e carga</h2><span>{agents.filter(a => onlineIds.has(a.id)).length} online</span></header>
          <p>Carga total ativa · clique para filtrar</p>
          {agentsStatus === 'loading' && <p role="status">Carregando equipe...</p>}
          {agentsStatus === 'error' && <p role="alert">Não foi possível carregar a equipe.</p>}
          <ul>{agents.map(agent => {
            const count = inProgress.filter(c => c.assignedAgentId === agent.id).length;
            const max = Math.max(1, ...agents.map(a => inProgress.filter(c => c.assignedAgentId === a.id).length));
            const online = onlineIds.has(agent.id);
            return <li key={agent.id}><button type="button" aria-pressed={agentFilter.includes(agent.id)} onClick={() => toggleFilterValue('atendente', agentFilter, agent.id)}>
              {/* A carga vem da mesma requisicao do painel: sem ela, nao da
                  para afirmar que o atendente esta sem atendimentos. */}
              <span className="supervision-agent-name">{agent.name || agent.email}</span><strong>{numero(count)}<small> ativos</small></strong>
              <span className="supervision-presence"><i className={online ? 'is-online' : ''} />{online ? (dashboardDataVisible ? (count ? 'Online · Em atendimento' : 'Online · Sem atendimentos') : 'Online') : 'Offline'}</span>
              <span className="supervision-load" aria-hidden="true"><span style={{width: (dashboardDataVisible ? count / max * 100 : 0) + '%'}} /></span>
            </button></li>;
          })}</ul>
          {agentsStatus === 'ready' && agents.length === 0 && <p>Nenhum atendente cadastrado.</p>}
        </aside>
        <main className="supervision-operation" aria-label="Operação">
          {!phoneSearchResult && activeTab === 'all' && <nav className="supervision-states" aria-label="Estados dos atendimentos">
            {[['all','Visão geral',totalActiveCount],['progress','Andamento',filteredInProgress.length],['waiting','Espera',filteredWaiting.length],['automation','Automação',filteredInAutomation.length]].map(([key,label,count]) => <button type="button" key={key} aria-pressed={operationView === key} onClick={() => setOperationView(key)}>{label}<strong>{numero(count)}</strong></button>)}
          </nav>}
          <div className="supervision-column-labels" aria-hidden="true"><span>Cliente / última mensagem</span><span>Cidade / setor</span><span>Responsável</span><span>Estado / horário</span><span /></div>
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
            <ul className="supervision-history">
              {phoneSearchResult.conversations.map(withAgentName).map((conversation) => (
                <SupervisionRow
                  key={conversation.id}
                  conversation={conversation}
                  onSelect={openConversation}
                  selected={false}
                  divided={false}
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
          {dashboardDataVisible && (operationView === 'all' || operationView === 'progress') && (          <DashboardColumn
            title="Em andamento"
            count={filteredInProgress.length}
            conversations={displayInProgress}
            onSelect={openConversation}
            emptyMessage="Nenhum atendimento em andamento."
          />)}
          {dashboardDataVisible && (operationView === 'all' || operationView === 'waiting') && (          <DashboardColumn
            title="Em espera"
            count={filteredWaiting.length}
            conversations={displayWaiting}
            onSelect={openConversation}
            onQuickClose={quickCloseConversation}
            emptyMessage="Nenhum atendimento em espera."
          />)}
          {dashboardDataVisible && (operationView === 'all' || operationView === 'automation') && (          <DashboardColumn
            title="Em automação"
            count={filteredInAutomation.length}
            conversations={displayInAutomation}
            onSelect={openConversation}
            onQuickClose={quickCloseConversation}
            emptyMessage="Nenhum atendimento em automação."
          />)}
        </div>
      ) : (
        <div id="tabpanel-closed" role="tabpanel" aria-labelledby="tab-closed" className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {displayClosed.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13.5px] text-chat-muted">Nenhum atendimento encerrado hoje.</p>
          ) : (
            <ul className="supervision-history">
              {displayClosed.map((conversation) => (
                <SupervisionRow
                  key={conversation.id}
                  conversation={conversation}
                  onSelect={openConversation}
                  selected={false}
                  divided={false}
                />
              ))}
            </ul>
          )}
          {closedHasMore && (
            <button
              type="button"
              onClick={loadMoreClosed}
              disabled={loadingClosed}
              className="mt-3 w-full rounded-[16px] border border-white/[0.10] bg-white/[0.06] px-4 py-3 text-[14px] font-medium text-chat-text transition hover:bg-white/[0.10] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingClosed ? 'Carregando...' : 'Carregar mais'}
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
