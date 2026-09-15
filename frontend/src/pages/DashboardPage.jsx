import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { closeConversation } from '../services/api';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';
import { Tabs } from '../components/ui/Tabs';
import { IconNewChat, IconSearch, IconLock, IconEmptyChat } from '../components/icons/WaIcons';

const TABS = [
  { value: 'inProgress', label: 'Em andamento' },
  { value: 'waiting', label: 'Em espera' },
  { value: 'automation', label: 'IA' },
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
  const { profileVersion, setConversationOpen } = useOutletContext();
  const { queue, status: queueStatus } = useQueue();
  const { conversations: myConversations, status: myConversationsStatus } = useMyConversations();
  const { name: companyName, status: companyNameStatus } = useCompanyName();
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
    setConversationOpen(Boolean(selectedConversation));
    return () => setConversationOpen(false);
  }, [Boolean(selectedConversation), setConversationOpen]);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-testid="channel-banner-wrapper" className={`relative ${selectedConversation ? 'hidden md:block' : ''}`}>
        <ChannelStatusBanner />
      </div>

      <div className="flex min-h-0 flex-1 gap-0 md:gap-3">
        <aside
          className={`${
            selectedConversation ? 'hidden' : 'flex'
          } w-full min-w-0 flex-col bg-white/[0.09] backdrop-blur-2xl md:flex md:w-[380px] md:shrink-0 md:overflow-clip md:rounded-[22px] md:border md:border-white/[0.07] lg:w-[28%] lg:min-w-[360px] lg:max-w-[440px]`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-4">
            <h1 className="font-display text-[20px] font-semibold leading-7 text-chat-text">Atendimento</h1>
            <button
              onClick={() => setStartingConversation(true)}
              aria-label="Nova conversa"
              title="Nova conversa"
              className="flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-chat-orange pl-2.5 pr-3.5 text-[13.5px] font-semibold text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
            >
              <IconNewChat size={18} />
              Nova
            </button>
          </div>

          <div className="shrink-0 px-4 pb-3">
            <label className="flex h-[42px] min-w-0 items-center gap-2.5 rounded-[12px] border border-white/[0.09] bg-white/[0.06] px-3.5 transition focus-within:border-white/20 focus-within:bg-white/[0.10]">
              <span className="shrink-0 text-chat-faint">
                <IconSearch size={18} />
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar conversa"
                aria-label="Buscar conversa"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-chat-text outline-none placeholder:text-chat-faint"
              />
            </label>
          </div>

          <div className="shrink-0">
            <Tabs
              look="underline"
              label="Filas"
              active={activeTab}
              onChange={setActiveTab}
              tabs={TABS.map((tab) => ({ key: tab.value, label: tab.label, count: tabCounts[tab.value] }))}
            />
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
                status={myConversationsStatus}
                onSelect={selectConversation}
                unreadIds={unreadIds}
                selectedId={selectedId}
              />
            )}
            {activeTab === 'waiting' && (
              <QueueList
                conversations={visibleWaiting}
                status={queueStatus}
                onSelect={setSelectedId}
                onQuickClose={quickCloseConversation}
                selectedId={selectedId}
                emptyMessage="Nenhum atendimento em espera."
              />
            )}
            {activeTab === 'automation' && (
              <QueueList
                conversations={visibleAutomation}
                status={queueStatus}
                onSelect={setSelectedId}
                onQuickClose={quickCloseConversation}
                selectedId={selectedId}
                emptyMessage="Nenhum atendimento em automação."
              />
            )}
          </div>

          <TeamPanel key={profileVersion} />
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
              <p className="mt-6 font-display text-[32px] font-light leading-tight text-chat-text/90">
                {companyNameStatus === 'loading' ? '' : companyName ? `${companyName} · Atendimento` : 'Atendimento'}
              </p>
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
