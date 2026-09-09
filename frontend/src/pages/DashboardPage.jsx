import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';
import {
  IconChats,
  IconChart,
  IconSettings,
  IconBellOn,
  IconBellOff,
  IconKey,
  IconLogout,
  IconNewChat,
  IconSearch,
  IconLock,
  IconEmptyChat,
  IconTeam,
} from '../components/icons/WaIcons';

const TABS = [
  { value: 'inProgress', label: 'Andamento' },
  { value: 'waiting', label: 'Espera' },
  { value: 'automation', label: 'Automação' },
];

function matchesSearch(conversation, term) {
  if (!term) return true;
  return [
    conversation.contactDisplayName,
    conversation.contactPhoneNumber,
    conversation.contactCityName,
    conversation.sectorName,
    conversation.lastMessageContent,
  ]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(term));
}

function RailButton({ label, onClick, children, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green ${
        active ? 'bg-[#e9edef] text-wa-text' : 'text-wa-icon hover:bg-[#e9edef]'
      }`}
    >
      {children}
    </button>
  );
}

function RailLink({ to, label, children }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full text-wa-icon transition-colors hover:bg-[#e9edef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green"
    >
      {children}
    </Link>
  );
}

function DashboardPage() {
  const { agent, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const [activeTab, setActiveTab] = useState('inProgress');
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const { unreadIds, clearUnread } = useUnreadMyConversations(myConversations, selectedId);

  function selectConversation(conversationId) {
    clearUnread(conversationId);
    setSelectedId(conversationId);
  }
  const [transferringId, setTransferringId] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [pendingConversation, setPendingConversation] = useState(null);

  const waitingConversations = queue.filter((c) => c.triageState !== 'pending');
  const automationConversations = queue.filter((c) => c.triageState === 'pending');

  const tabCounts = {
    inProgress: myConversations.length,
    waiting: waitingConversations.length,
    automation: automationConversations.length,
  };

  const term = search.trim().toLowerCase();
  const visibleMine = myConversations.filter((c) => matchesSearch(c, term));
  const visibleWaiting = waitingConversations.filter((c) => matchesSearch(c, term));
  const visibleAutomation = automationConversations.filter((c) => matchesSearch(c, term));

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  useEffect(() => {
    if (pendingConversation && [...queue, ...myConversations].some((c) => c.id === pendingConversation.id)) {
      setPendingConversation(null);
    }
  }, [queue, myConversations, pendingConversation]);

  useEffect(() => {
    if (location.state && location.state.pendingConversation) {
      const conversation = location.state.pendingConversation;
      setPendingConversation(conversation);
      setSelectedId(conversation.id);
      navigate(location.pathname, { replace: true, state: null });
    }
    // Only ever consume the one-shot navigation payload on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentInitial = agent?.name ? agent.name.trim().charAt(0).toUpperCase() : 'DW';

  return (
    <div className="flex h-dvh flex-col bg-wa-page font-wa text-wa-text">
      <div data-testid="channel-banner-wrapper" className={selectedConversation ? 'hidden md:block' : ''}>
        <ChannelStatusBanner />
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Navegação principal"
          className={`${
            selectedConversation ? 'hidden md:flex' : 'flex'
          } w-14 shrink-0 flex-col items-center justify-between border-r border-wa-border bg-wa-panel-header py-3 md:w-[60px]`}
        >
          <div className="flex flex-col items-center gap-1">
            <span
              aria-hidden="true"
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-wa-green text-[13px] font-bold tracking-tight text-white"
            >
              DW
            </span>
            <RailButton label="Conversas" active onClick={() => setSelectedId(null)}>
              <IconChats size={23} />
            </RailButton>
            <RailLink to="/metrics" label="Métricas">
              <IconChart size={22} />
            </RailLink>
            {agent?.role === 'admin' && (
              <>
                <RailLink to="/admin/dashboard" label="Dashboard de atendimento">
                  <IconTeam size={22} />
                </RailLink>
                <RailLink to="/admin/channels" label="Administração">
                  <IconSettings size={22} />
                </RailLink>
              </>
            )}
          </div>

          <div className="flex flex-col items-center gap-1">
            <RailButton
              label={muted ? 'Som mutado' : 'Som ativado'}
              onClick={toggleMuted}
              active={muted}
            >
              {muted ? <IconBellOff size={21} /> : <IconBellOn size={21} />}
            </RailButton>
            <RailButton label="Trocar senha" onClick={() => setChangingPassword(true)}>
              <IconKey size={21} />
            </RailButton>
            <RailButton label="Sair" onClick={logout}>
              <IconLogout size={21} />
            </RailButton>
            <span
              aria-hidden="true"
              title={agent?.name || 'Atendente'}
              className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[#dfe5e7] text-[13px] font-medium text-[#8696a0]"
            >
              {agentInitial}
            </span>
          </div>
        </nav>

        <aside
          className={`${
            selectedConversation ? 'hidden' : 'flex'
          } w-full min-w-0 flex-col border-r border-wa-border bg-wa-panel md:flex md:w-[400px] md:shrink-0 lg:w-[30%] lg:min-w-[360px] lg:max-w-[500px]`}
        >
          <header
            className={`${
              selectedConversation ? 'hidden md:flex' : 'flex'
            } h-[59px] shrink-0 items-center justify-between gap-2 px-4`}
          >
            <span className="truncate text-[19px] font-bold leading-tight tracking-[-0.01em] text-wa-green-dark">
              DW Telecom
            </span>
            <button
              onClick={() => setStartingConversation(true)}
              aria-label="Iniciar conversa"
              title="Iniciar conversa"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-green text-white shadow-[0_1px_3px_rgba(11,20,26,.16)] transition-colors hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green-dark"
            >
              <IconNewChat size={22} />
            </button>
          </header>

          <div className="shrink-0 px-3 pb-2">
            <label className="flex h-[35px] items-center gap-3 rounded-[8px] bg-wa-panel-header px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-wa-green/60">
              <span className="shrink-0 text-wa-icon">
                <IconSearch size={18} />
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar uma conversa"
                aria-label="Pesquisar uma conversa"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-wa-text outline-none placeholder:text-wa-muted"
              />
            </label>
          </div>

          <div role="tablist" className="flex shrink-0 gap-2 overflow-x-auto px-3 pb-2">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                id={`tab-${tab.value}`}
                role="tab"
                aria-selected={activeTab === tab.value}
                aria-controls={`tabpanel-${tab.value}`}
                onClick={() => setActiveTab(tab.value)}
                className={`shrink-0 rounded-full px-3 py-[5px] text-[14px] leading-[20px] transition-colors ${
                  activeTab === tab.value
                    ? 'bg-wa-chip font-medium text-wa-chip-text'
                    : 'bg-wa-panel-header text-wa-muted hover:bg-wa-border'
                }`}
              >
                {tab.label}
                {tabCounts[tab.value] > 0 && (
                  <span className="ml-1.5 font-medium">{tabCounts[tab.value]}</span>
                )}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="wa-scroll min-h-0 flex-1 overflow-y-auto border-t border-wa-border"
          >
            {activeTab === 'inProgress' && (
              <MyConversationsList
                conversations={visibleMine}
                onSelect={selectConversation}
                unreadIds={unreadIds}
                selectedId={selectedId}
              />
            )}
            {activeTab === 'waiting' && (
              <QueueList
                conversations={visibleWaiting}
                onSelect={setSelectedId}
                selectedId={selectedId}
                emptyMessage="Nenhuma conversa aguardando."
              />
            )}
            {activeTab === 'automation' && (
              <QueueList
                conversations={visibleAutomation}
                onSelect={setSelectedId}
                selectedId={selectedId}
                emptyMessage="Nenhuma conversa em triagem automática."
              />
            )}
          </div>

          <TeamPanel />
        </aside>

        <main className={`${selectedConversation ? 'block' : 'hidden'} min-w-0 flex-1 md:block`}>
          {selectedConversation ? (
            <ConversationView
              conversation={selectedConversation}
              onTransferClick={setTransferringId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center border-b-[6px] border-wa-badge bg-wa-panel-header px-6 text-center">
              <span className="text-[#d5dbde]">
                <IconEmptyChat width={320} height={190} />
              </span>
              <p className="mt-6 text-[32px] font-light leading-tight text-[#41525d]">DW Telecom Atendimento</p>
              <p className="mt-3 max-w-[38ch] text-[14px] leading-[20px] text-wa-muted">
                Selecione uma conversa na lista ao lado para ler o histórico e responder ao cliente.
              </p>
              <p className="mt-10 flex items-center gap-1.5 text-[13px] text-wa-meta">
                <IconLock size={13} />
                Todo atendimento fica registrado no sistema.
              </p>
            </div>
          )}
        </main>
      </div>

      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      {startingConversation && (
        <StartConversationModal
          onClose={() => setStartingConversation(false)}
          onCreated={(conversation) => {
            setPendingConversation(conversation);
            setSelectedId(conversation.id);
            setStartingConversation(false);
          }}
        />
      )}
    </div>
  );
}

export default DashboardPage;
