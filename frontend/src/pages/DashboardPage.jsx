import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { closeConversation } from '../services/api';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ProfileModal from '../components/ProfileModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';
import NavRail from '../components/NavRail';
import { IconNewChat, IconSearch, IconLock, IconEmptyChat } from '../components/icons/WaIcons';

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

function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const [activeTab, setActiveTab] = useState('inProgress');
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const { unreadIds, clearUnread } = useUnreadMyConversations(myConversations, selectedId);

  function selectConversation(conversationId) {
    clearUnread(conversationId);
    setSelectedId(conversationId);
  }

  function quickCloseConversation(conversationId) {
    closeConversation(conversationId, null, token).catch(() => {});
  }

  const [transferringId, setTransferringId] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [teamPanelKey, setTeamPanelKey] = useState(0);
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

  return (
    <div className="chat-theme relative flex h-dvh flex-col overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[44%] top-[2%] h-[38rem] w-[40rem] rounded-full bg-chat-copper/55 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[36%] top-[40%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/35 blur-[150px]"
      />

      <div data-testid="channel-banner-wrapper" className={`relative ${selectedConversation ? 'hidden md:block' : ''}`}>
        <ChannelStatusBanner />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 gap-0 p-0 md:gap-3 md:p-3">
        <NavRail
          active="conversas"
          onConversasClick={() => setSelectedId(null)}
          onProfileClick={() => setProfileOpen(true)}
          mobileHidden={Boolean(selectedConversation)}
        />

        <aside
          className={`${
            selectedConversation ? 'hidden' : 'flex'
          } w-full min-w-0 flex-col bg-white/[0.09] backdrop-blur-2xl md:flex md:w-[380px] md:shrink-0 md:overflow-clip md:rounded-[22px] md:border md:border-white/[0.07] lg:w-[28%] lg:min-w-[360px] lg:max-w-[440px]`}
        >
          <div className="flex shrink-0 items-center gap-3.5 px-3 pb-2 pt-[18px]">
            <label className="flex h-[46px] min-w-0 flex-1 items-center gap-3 rounded-full border border-white/[0.07] bg-white/[0.06] px-4 transition focus-within:border-white/20 focus-within:bg-white/[0.10]">
              <span className="shrink-0 text-chat-faint">
                <IconSearch size={19} />
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar uma conversa"
                aria-label="Pesquisar uma conversa"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-chat-text outline-none placeholder:text-chat-faint"
              />
            </label>
            <button
              onClick={() => setStartingConversation(true)}
              aria-label="Iniciar conversa"
              title="Iniciar conversa"
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-white/[0.13] text-chat-text transition hover:bg-white/[0.18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              <IconNewChat size={24} />
            </button>
          </div>

          <div role="tablist" className="flex shrink-0 gap-3.5 overflow-x-auto px-3 pb-3 pt-4">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                id={`tab-${tab.value}`}
                role="tab"
                aria-selected={activeTab === tab.value}
                aria-controls={`tabpanel-${tab.value}`}
                onClick={() => setActiveTab(tab.value)}
                className={`relative shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
                  activeTab === tab.value
                    ? 'border-chat-orange/70 text-chat-text'
                    : 'border-white/[0.12] text-chat-muted hover:text-chat-text'
                }`}
              >
                {tab.label}
                {tabCounts[tab.value] > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-chat-orange px-1 text-[12px] font-semibold text-white">
                    {tabCounts[tab.value]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="chat-scroll min-h-0 flex-1 overflow-y-auto pt-3"
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
                onQuickClose={quickCloseConversation}
                selectedId={selectedId}
                emptyMessage="Nenhuma conversa aguardando."
              />
            )}
            {activeTab === 'automation' && (
              <QueueList
                conversations={visibleAutomation}
                onSelect={setSelectedId}
                onQuickClose={quickCloseConversation}
                selectedId={selectedId}
                emptyMessage="Nenhuma conversa em triagem automática."
              />
            )}
          </div>

          <TeamPanel key={teamPanelKey} />
        </aside>

        <main
          className={`${
            selectedConversation ? 'block' : 'hidden'
          } min-w-0 flex-1 md:block md:overflow-clip md:rounded-[22px] md:border md:border-white/[0.07]`}
        >
          {selectedConversation ? (
            <ConversationView
              conversation={selectedConversation}
              onTransferClick={setTransferringId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-white/[0.08] px-6 text-center backdrop-blur-2xl md:rounded-[22px]">
              <span className="text-white/10">
                <IconEmptyChat width={320} height={190} />
              </span>
              <p className="mt-6 font-display text-[32px] font-light leading-tight text-chat-text/90">DW Telecom Atendimento</p>
              <p className="mt-3 max-w-[38ch] text-[14px] leading-[20px] text-chat-muted">
                Selecione uma conversa na lista ao lado para ler o histórico e responder ao cliente.
              </p>
              <p className="mt-10 flex items-center gap-1.5 text-[13px] text-chat-faint">
                <IconLock size={13} />
                Todo atendimento fica registrado no sistema.
              </p>
            </div>
          )}
        </main>
      </div>

      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
      {profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} onProfileUpdated={() => setTeamPanelKey((k) => k + 1)} />
      )}
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
