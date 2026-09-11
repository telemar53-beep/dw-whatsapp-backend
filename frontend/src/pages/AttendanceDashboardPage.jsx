import { useState, useEffect, useMemo, useRef } from 'react';
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
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';
import ConversationModal from '../components/ConversationModal';
import TransferModal from '../components/TransferModal';

const CLOSED_PAGE_SIZE = 20;

function matchesFilters(conversation, { channelIds, agentIds, sectorIds }) {
  if (channelIds.length > 0 && !channelIds.includes(conversation.channelId)) return false;
  if (agentIds.length > 0 && !agentIds.includes(conversation.assignedAgentId)) return false;
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
        className="h-[38px] rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-[14px] text-chat-muted transition hover:bg-white/[0.10] hover:text-chat-text"
      >
        {label}
        {selected.length > 0 && <span className="ml-1.5 font-medium text-chat-orange">{selected.length}</span>}
      </button>
      {open && (
        <div className="chat-scroll absolute z-10 mt-2 max-h-64 w-56 overflow-y-auto rounded-[16px] border border-white/[0.10] bg-wa-panel p-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[13px] text-wa-muted">Nenhuma opção</p>
          ) : (
            options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-[13.5px] text-chat-muted hover:bg-white/[0.07] hover:text-chat-text">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} className="h-4 w-4 accent-chat-orange" />
                {option.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DashboardColumn({ title, count, conversations, onSelect, onQuickClose, emptyMessage, footer }) {
  return (
    <div className="flex min-w-[300px] flex-1 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.08] backdrop-blur-2xl">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="font-display text-[16px] font-semibold text-chat-text">{title}</h2>
        <span className="rounded-full border border-white/10 bg-white/[0.07] px-2.5 py-[2px] text-[12px] font-medium text-chat-muted">
          {count}
        </span>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-0.5">
        {conversations.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13.5px] text-chat-faint">{emptyMessage}</p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                onSelect={onSelect}
                onQuickClose={onQuickClose}
                selected={false}
              />
            ))}
          </ul>
        )}
      </div>
      {footer}
    </div>
  );
}

function AttendanceDashboardPage() {
  const { token } = useAuth();
  const { inProgress, waiting, inAutomation, closedTodayCount } = useAttendanceDashboard();
  const { channels } = useChannels(true);
  const agents = useAgents();
  const { sectors } = useSectors();

  const [activeTab, setActiveTab] = useState('all');
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);

  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name || a.email])),
    [agents]
  );

  const [channelFilter, setChannelFilter] = useState([]);
  const [agentFilter, setAgentFilter] = useState([]);
  const [sectorFilter, setSectorFilter] = useState([]);
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

  useEffect(() => {
    if (!token) return;
    getDashboardClosedToday({ offset: 0, limit: CLOSED_PAGE_SIZE }, token)
      .then((data) => {
        setClosedItems(data.items);
        setClosedOffset(data.items.length);
        setClosedHasMore(data.hasMore);
      })
      .catch(() => {});
  }, [token]);

  function loadMoreClosed() {
    setLoadingClosed(true);
    getDashboardClosedToday({ offset: closedOffset, limit: CLOSED_PAGE_SIZE }, token)
      .then((data) => {
        setClosedItems((prev) => [...prev, ...data.items]);
        setClosedOffset((prev) => prev + data.items.length);
        setClosedHasMore(data.hasMore);
        setLoadingClosed(false);
      })
      .catch(() => setLoadingClosed(false));
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
    return agentName ? { ...conversation, assignedAgentName: agentName } : conversation;
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
    closeConversation(conversationId, null, token).catch(() => {});
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

  function toggleFilterValue(setFilter, value) {
    setFilter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[38%] -top-[10%] h-[38rem] w-[42rem] rounded-full bg-chat-copper/45 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[6%] bottom-[-15%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/25 blur-[150px]"
      />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
      <NavRail active="dashboard" onProfileClick={() => setProfileOpen(true)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between px-2 pb-4 pt-2">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
            Dashboard de atendimento
          </h1>
          <p className="mt-1.5 text-[14px] text-chat-muted">Acompanhe os atendimentos da equipe em tempo real</p>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 px-2 pb-4">
        <div role="tablist" className="flex gap-3.5">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            className={`relative shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition ${
              activeTab === 'all'
                ? 'border-chat-orange/70 text-chat-text'
                : 'border-white/[0.12] text-chat-muted hover:text-chat-text'
            }`}
          >
            Todos atendimentos
            {totalActiveCount > 0 && (
              <span
                data-testid="tab-count-all"
                className="absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-chat-orange px-1 text-[12px] font-semibold text-white"
              >
                {totalActiveCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'closed'}
            onClick={() => setActiveTab('closed')}
            className={`relative shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition ${
              activeTab === 'closed'
                ? 'border-chat-orange/70 text-chat-text'
                : 'border-white/[0.12] text-chat-muted hover:text-chat-text'
            }`}
          >
            Encerrados hoje
            {closedCount > 0 && (
              <span
                data-testid="tab-count-closed"
                className="absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-chat-orange px-1 text-[12px] font-semibold text-white"
              >
                {closedCount}
              </span>
            )}
          </button>
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-white/10" />
        <FilterDropdown
          label="Canais"
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
          selected={channelFilter}
          onToggle={(value) => toggleFilterValue(setChannelFilter, value)}
          open={openFilterMenu === 'channels'}
          onOpenChange={(next) => setOpenFilterMenu(next ? 'channels' : null)}
        />
        <FilterDropdown
          label="Atendentes"
          options={agents.map((a) => ({ value: a.id, label: a.name || a.email }))}
          selected={agentFilter}
          onToggle={(value) => toggleFilterValue(setAgentFilter, value)}
          open={openFilterMenu === 'agents'}
          onOpenChange={(next) => setOpenFilterMenu(next ? 'agents' : null)}
        />
        <FilterDropdown
          label="Departamentos"
          options={sectors.map((s) => ({ value: s.id, label: s.name }))}
          selected={sectorFilter}
          onToggle={(value) => toggleFilterValue(setSectorFilter, value)}
          open={openFilterMenu === 'sectors'}
          onOpenChange={(next) => setOpenFilterMenu(next ? 'sectors' : null)}
        />
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-white/10" />
        <form onSubmit={handleProtocolSearch}>
          <input
            type="text"
            value={protocolQuery}
            onChange={(e) => setProtocolQuery(e.target.value)}
            placeholder="Buscar por protocolo"
            aria-label="Buscar por protocolo"
            className="h-[38px] w-[170px] rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-[14px] text-chat-text outline-none placeholder:text-chat-muted focus:border-white/25"
          />
        </form>
        <form onSubmit={handlePhoneSearch}>
          <input
            type="text"
            value={phoneQuery}
            onChange={(e) => setPhoneQuery(e.target.value)}
            placeholder="Buscar por telefone do cliente"
            aria-label="Buscar por telefone do cliente"
            className="h-[38px] w-[220px] rounded-full border border-white/[0.12] bg-white/[0.06] px-4 text-[14px] text-chat-text outline-none placeholder:text-chat-muted focus:border-white/25"
          />
        </form>
      </div>
      {(protocolError || phoneError) && (
        <p className="px-2 pb-2 text-[13px] text-chat-faint">{protocolError || phoneError}</p>
      )}

      {phoneSearchResult ? (
        <div role="tabpanel" className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[14px] text-chat-muted">
              {phoneSearchResult.conversations.length} atendimento(s) de{' '}
              {phoneSearchResult.contact.displayName || phoneSearchResult.contact.phoneNumber}
            </p>
            <button
              type="button"
              onClick={clearPhoneSearch}
              className="text-[13px] font-medium text-chat-orange hover:underline"
            >
              Limpar busca
            </button>
          </div>
          {phoneSearchResult.conversations.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13.5px] text-chat-faint">Esse cliente ainda não teve nenhum atendimento.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>li]:overflow-clip [&>li]:rounded-[18px] [&>li]:border [&>li]:border-white/[0.07] [&>li]:bg-white/[0.08] [&>li]:backdrop-blur-2xl">
              {phoneSearchResult.conversations.map(withAgentName).map((conversation) => (
                <ConversationListItem key={conversation.id} conversation={conversation} onSelect={openConversation} selected={false} />
              ))}
            </ul>
          )}
        </div>
      ) : activeTab === 'all' ? (
        <div role="tabpanel" className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-2 pb-2">
          <DashboardColumn
            title="Em andamento"
            count={filteredInProgress.length}
            conversations={displayInProgress}
            onSelect={openConversation}
            emptyMessage="Nenhum atendimento em andamento."
          />
          <DashboardColumn
            title="Em espera"
            count={filteredWaiting.length}
            conversations={displayWaiting}
            onSelect={openConversation}
            onQuickClose={quickCloseConversation}
            emptyMessage="Nenhuma conversa aguardando."
          />
          <DashboardColumn
            title="Na automação"
            count={filteredInAutomation.length}
            conversations={displayInAutomation}
            onSelect={openConversation}
            onQuickClose={quickCloseConversation}
            emptyMessage="Nenhuma conversa em triagem automática."
          />
        </div>
      ) : (
        <div role="tabpanel" className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {displayClosed.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13.5px] text-chat-faint">Nenhum atendimento encerrado nas últimas 24 horas.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>li]:overflow-clip [&>li]:rounded-[18px] [&>li]:border [&>li]:border-white/[0.07] [&>li]:bg-white/[0.08] [&>li]:backdrop-blur-2xl">
              {displayClosed.map((conversation) => (
                <ConversationListItem key={conversation.id} conversation={conversation} onSelect={openConversation} selected={false} />
              ))}
            </ul>
          )}
          {closedHasMore && (
            <button
              type="button"
              onClick={loadMoreClosed}
              disabled={loadingClosed}
              className="mt-3 w-full rounded-[16px] border border-white/[0.10] bg-white/[0.06] px-4 py-3 text-[14px] font-medium text-chat-text transition hover:bg-white/[0.10] disabled:opacity-50"
            >
              {loadingClosed ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}
      </div>
      </div>
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {selectedConversation && (
        <ConversationModal
          conversation={selectedConversation}
          onClose={() => setSelectedConversationId(null)}
          onTransferClick={setTransferringId}
        />
      )}
      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
    </div>
  );
}

export default AttendanceDashboardPage;
