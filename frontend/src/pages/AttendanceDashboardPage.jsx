import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { getDashboardClosedToday } from '../services/api';
import ConversationListItem from '../components/ConversationListItem';
import NavRail from '../components/NavRail';
import ChangePasswordModal from '../components/ChangePasswordModal';
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
        className="rounded-full border border-white/60 bg-white/40 px-3 py-1.5 text-[13px] text-ink-950/70 backdrop-blur-md transition hover:bg-white/60 hover:text-ink-950"
      >
        {label}
        {selected.length > 0 && <span className="ml-1.5 font-medium text-teal-signal">{selected.length}</span>}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-white/70 bg-white/90 p-2 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[13px] text-ink-950/50">Nenhuma opção</p>
          ) : (
            options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] text-ink-950/80 hover:bg-teal-signal/10">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
                {option.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DashboardColumn({ title, count, conversations, onSelect, emptyMessage, footer }) {
  return (
    <div className="flex min-w-[280px] flex-1 flex-col rounded-2xl border border-white/70 bg-white/50 backdrop-blur-xl shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)]">
      <div className="flex items-center justify-between border-b border-white/50 px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold text-ink-950">{title}</h2>
        <span className="rounded-full bg-teal-signal/10 px-2 py-[1px] text-[12px] font-medium text-teal-signal">{count}</span>
      </div>
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-950/50">{emptyMessage}</p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <ConversationListItem key={conversation.id} conversation={conversation} onSelect={onSelect} selected={false} />
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
  const [changingPassword, setChangingPassword] = useState(false);
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

  const selectedConversation =
    [...inProgress, ...waiting, ...inAutomation, ...closedItems].find((c) => c.id === selectedConversationId) || null;

  function toggleFilterValue(setFilter, value) {
    setFilter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-signal/20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-amber-signal/20 blur-[120px]"
      />
      <NavRail active="dashboard" onChangePasswordClick={() => setChangingPassword(true)} />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gradient-to-br from-sky-mist via-teal-mist to-sand-mist font-sans text-ink-950">
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-950">Dashboard de atendimento</h1>
          <p className="mt-1 text-sm text-ink-950/55">Acompanhe os atendimentos da equipe em tempo real</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
        <div role="tablist" className="inline-flex gap-1 rounded-full border border-white/70 bg-white/40 p-1 backdrop-blur-xl shadow-sm">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            className={`relative rounded-full px-4 py-1.5 text-sm transition ${
              activeTab === 'all' ? 'bg-teal-signal font-semibold text-white shadow-sm' : 'font-medium text-ink-950/55 hover:text-ink-950'
            }`}
          >
            Todos atendimentos
            {totalActiveCount > 0 && (
              <span
                data-testid="tab-count-all"
                className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white"
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
            className={`relative rounded-full px-4 py-1.5 text-sm transition ${
              activeTab === 'closed' ? 'bg-teal-signal font-semibold text-white shadow-sm' : 'font-medium text-ink-950/55 hover:text-ink-950'
            }`}
          >
            Encerrados hoje
            {closedCount > 0 && (
              <span
                data-testid="tab-count-closed"
                className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white"
              >
                {closedCount}
              </span>
            )}
          </button>
        </div>
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
      </div>

      {activeTab === 'all' ? (
        <div role="tabpanel" className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
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
            emptyMessage="Nenhuma conversa aguardando."
          />
          <DashboardColumn
            title="Na automação"
            count={filteredInAutomation.length}
            conversations={displayInAutomation}
            onSelect={openConversation}
            emptyMessage="Nenhuma conversa em triagem automática."
          />
        </div>
      ) : (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
          {displayClosed.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-950/50">Nenhum atendimento encerrado nas últimas 24 horas.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>li]:overflow-hidden [&>li]:rounded-xl [&>li]:border [&>li]:border-white/70 [&>li]:bg-white/50 [&>li]:backdrop-blur-xl [&>li]:shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)]">
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
              className="mt-4 w-full rounded-xl border border-white/70 bg-white/50 px-4 py-2 text-[13px] font-medium text-teal-signal backdrop-blur-xl transition hover:bg-white/70 disabled:opacity-50"
            >
              {loadingClosed ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}
      </div>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
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
