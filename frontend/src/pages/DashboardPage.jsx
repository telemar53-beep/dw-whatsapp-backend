import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
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
    <div className="relative flex h-dvh flex-col overflow-hidden bg-gradient-to-br from-sky-mist via-teal-mist to-sand-mist font-sans text-ink-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-signal/20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-amber-signal/20 blur-[120px]"
      />

      <div data-testid="channel-banner-wrapper" className={`relative ${selectedConversation ? 'hidden md:block' : ''}`}>
        <ChannelStatusBanner />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <NavRail
          active="conversas"
          onConversasClick={() => setSelectedId(null)}
          onProfileClick={() => setProfileOpen(true)}
          mobileHidden={Boolean(selectedConversation)}
        />

        <aside
          className={`${
            selectedConversation ? 'hidden' : 'flex'
          } w-full min-w-0 flex-col border-r border-white/50 bg-white/40 backdrop-blur-2xl md:flex md:w-[400px] md:shrink-0 lg:w-[30%] lg:min-w-[360px] lg:max-w-[500px]`}
        >
          <header
            className={`${
              selectedConversation ? 'hidden md:flex' : 'flex'
            } h-[59px] shrink-0 items-center justify-between gap-2 px-4`}
          >
            <span className="truncate font-display text-xl font-semibold leading-tight tracking-[-0.01em] text-ink-950">
              DW Telecom
            </span>
            <button
              onClick={() => setStartingConversation(true)}
              aria-label="Iniciar conversa"
              title="Iniciar conversa"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-signal text-white shadow-[0_10px_24px_-8px_rgba(13,148,136,0.55)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-signal"
            >
              <IconNewChat size={22} />
            </button>
          </header>

          <div className="shrink-0 px-3 pb-2">
            <label className="flex h-[38px] items-center gap-3 rounded-xl border border-ink-950/10 bg-white/50 px-3 transition focus-within:border-teal-signal/50 focus-within:bg-white/80 focus-within:ring-2 focus-within:ring-teal-signal/20">
              <span className="shrink-0 text-ink-950/40">
                <IconSearch size={18} />
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar uma conversa"
                aria-label="Pesquisar uma conversa"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink-950 outline-none placeholder:text-ink-950/35"
              />
            </label>
          </div>

          <div className="flex shrink-0 justify-center overflow-x-auto px-3 pt-2 pb-2">
            <div role="tablist" className="inline-flex gap-1 rounded-full border border-white/70 bg-white/40 p-1 backdrop-blur-xl shadow-sm">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  id={`tab-${tab.value}`}
                  role="tab"
                  aria-selected={activeTab === tab.value}
                  aria-controls={`tabpanel-${tab.value}`}
                  onClick={() => setActiveTab(tab.value)}
                  className={`relative shrink-0 rounded-full px-4 py-1.5 text-sm transition ${
                    activeTab === tab.value
                      ? 'bg-teal-signal font-semibold text-white shadow-sm'
                      : 'font-medium text-ink-950/55 hover:text-ink-950'
                  }`}
                >
                  {tab.label}
                  {tabCounts[tab.value] > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                      {tabCounts[tab.value]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="wa-scroll min-h-0 flex-1 overflow-y-auto border-t border-white/40"
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

          <TeamPanel key={teamPanelKey} />
        </aside>

        <main className={`${selectedConversation ? 'block' : 'hidden'} min-w-0 flex-1 md:block`}>
          {selectedConversation ? (
            <ConversationView
              conversation={selectedConversation}
              onTransferClick={setTransferringId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center border-b-[6px] border-teal-signal/60 bg-white/25 px-6 text-center backdrop-blur-sm">
              <span className="text-ink-950/20">
                <IconEmptyChat width={320} height={190} />
              </span>
              <p className="mt-6 font-display text-[32px] font-light leading-tight text-ink-950/80">DW Telecom Atendimento</p>
              <p className="mt-3 max-w-[38ch] text-[14px] leading-[20px] text-ink-950/55">
                Selecione uma conversa na lista ao lado para ler o histórico e responder ao cliente.
              </p>
              <p className="mt-10 flex items-center gap-1.5 text-[13px] text-ink-950/45">
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
