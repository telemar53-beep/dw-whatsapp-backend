import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { getDashboardClosedToday } from '../services/api';
import ConversationListItem from '../components/ConversationListItem';
import NavRail from '../components/NavRail';
import ChangePasswordModal from '../components/ChangePasswordModal';

const CLOSED_PAGE_SIZE = 20;

function matchesFilters(conversation, { channelIds, agentIds, sectorIds }) {
  if (channelIds.length > 0 && !channelIds.includes(conversation.channelId)) return false;
  if (agentIds.length > 0 && !agentIds.includes(conversation.assignedAgentId)) return false;
  if (sectorIds.length > 0 && !sectorIds.includes(conversation.sectorId)) return false;
  return true;
}

function FilterDropdown({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-full border border-wa-border bg-wa-panel px-3 py-1.5 text-[13px] text-wa-text hover:bg-wa-hover"
      >
        {label}
        {selected.length > 0 && <span className="ml-1.5 font-medium">{selected.length}</span>}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-wa-border bg-wa-panel p-2 shadow-lg">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-[13px] text-wa-muted">Nenhuma opção</p>
          ) : (
            options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-wa-hover">
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
    <div className="flex min-w-[280px] flex-1 flex-col rounded-lg border border-wa-border bg-wa-panel">
      <div className="flex items-center justify-between border-b border-wa-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-wa-text">{title}</h2>
        <span className="rounded-full bg-wa-chip px-2 py-[1px] text-[12px] font-medium text-wa-chip-text">{count}</span>
      </div>
      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-wa-muted">{emptyMessage}</p>
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
  const navigate = useNavigate();
  const { inProgress, waiting, inAutomation, closedTodayCount } = useAttendanceDashboard();
  const { channels } = useChannels(true);
  const agents = useAgents();
  const { sectors } = useSectors();

  const [activeTab, setActiveTab] = useState('all');
  const [changingPassword, setChangingPassword] = useState(false);

  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name || a.email])),
    [agents]
  );

  const [channelFilter, setChannelFilter] = useState([]);
  const [agentFilter, setAgentFilter] = useState([]);
  const [sectorFilter, setSectorFilter] = useState([]);

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
    const conversation =
      filteredInProgress.find((c) => c.id === conversationId) ||
      filteredWaiting.find((c) => c.id === conversationId) ||
      filteredInAutomation.find((c) => c.id === conversationId) ||
      filteredClosed.find((c) => c.id === conversationId);
    navigate('/', { state: { pendingConversation: conversation } });
  }

  function toggleFilterValue(setFilter, value) {
    setFilter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="flex h-dvh">
      <NavRail active="dashboard" onChangePasswordClick={() => setChangingPassword(true)} />
      <div className="flex min-h-0 flex-1 flex-col bg-wa-page font-wa text-wa-text">
      <header className="flex items-center justify-between border-b border-wa-border px-6 py-4">
        <h1 className="text-[19px] font-bold text-wa-green-dark">Dashboard de atendimento</h1>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-wa-border px-6 py-3">
        <div role="tablist" className="flex gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === 'all' ? 'bg-wa-green text-white' : 'border border-wa-border bg-wa-panel text-wa-text hover:bg-wa-hover'
            }`}
          >
            <span>Todos atendimentos</span>
            <span
              data-testid="tab-count-all"
              className={`rounded-full px-1.5 text-[11px] font-medium ${
                activeTab === 'all' ? 'bg-white/25' : 'bg-wa-chip text-wa-chip-text'
              }`}
            >
              {totalActiveCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'closed'}
            onClick={() => setActiveTab('closed')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === 'closed' ? 'bg-wa-green text-white' : 'border border-wa-border bg-wa-panel text-wa-text hover:bg-wa-hover'
            }`}
          >
            <span>Encerrados hoje</span>
            <span
              data-testid="tab-count-closed"
              className={`rounded-full px-1.5 text-[11px] font-medium ${
                activeTab === 'closed' ? 'bg-white/25' : 'bg-wa-chip text-wa-chip-text'
              }`}
            >
              {closedCount}
            </span>
          </button>
        </div>
        <FilterDropdown
          label="Canais"
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
          selected={channelFilter}
          onToggle={(value) => toggleFilterValue(setChannelFilter, value)}
        />
        <FilterDropdown
          label="Atendentes"
          options={agents.map((a) => ({ value: a.id, label: a.name || a.email }))}
          selected={agentFilter}
          onToggle={(value) => toggleFilterValue(setAgentFilter, value)}
        />
        <FilterDropdown
          label="Departamentos"
          options={sectors.map((s) => ({ value: s.id, label: s.name }))}
          selected={sectorFilter}
          onToggle={(value) => toggleFilterValue(setSectorFilter, value)}
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
            <p className="px-4 py-8 text-center text-[13px] text-wa-muted">Nenhum atendimento encerrado nas últimas 24 horas.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>li]:overflow-hidden [&>li]:rounded-lg [&>li]:border [&>li]:border-wa-border [&>li]:bg-wa-panel">
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
              className="mt-4 w-full rounded-lg border border-wa-border bg-wa-panel px-4 py-2 text-[13px] font-medium text-wa-green-dark hover:bg-wa-hover disabled:opacity-50"
            >
              {loadingClosed ? 'Carregando...' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}
      </div>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

export default AttendanceDashboardPage;
