import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';

const TABS = [
  { value: 'inProgress', label: 'Andamento' },
  { value: 'waiting', label: 'Espera' },
  { value: 'automation', label: 'Automação' },
];

function TabBadge({ count }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
      {count}
    </span>
  );
}

function DashboardPage() {
  const { agent, logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const [activeTab, setActiveTab] = useState('inProgress');
  const [selectedId, setSelectedId] = useState(null);
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

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  useEffect(() => {
    if (pendingConversation && [...queue, ...myConversations].some((c) => c.id === pendingConversation.id)) {
      setPendingConversation(null);
    }
  }, [queue, myConversations, pendingConversation]);

  return (
    <div className="flex h-dvh flex-col">
      <div data-testid="channel-banner-wrapper" className={selectedConversation ? 'hidden md:block' : ''}>
        <ChannelStatusBanner />
      </div>
      <header
        className={`${selectedConversation ? 'hidden md:flex' : 'flex'} items-center justify-between border-b border-gray-200 px-4 py-2`}
      >
        <h1 className="font-semibold text-gray-800">DW Telecom - Atendimento</h1>
        <div className="flex flex-wrap items-center gap-4">
          {agent?.role === 'admin' && (
            <Link to="/admin/channels" className="text-sm text-gray-500 hover:underline">
              Administração
            </Link>
          )}
          <Link to="/metrics" className="text-sm text-gray-500 hover:underline">
            Métricas
          </Link>
          <button
            onClick={toggleMuted}
            aria-pressed={muted}
            title={muted ? 'Ativar som de notificações' : 'Mutar som de notificações'}
            className="text-sm text-gray-500 hover:underline"
          >
            {muted ? '🔕 Som mutado' : '🔔 Som ativado'}
          </button>
          <button onClick={() => setChangingPassword(true)} className="text-sm text-gray-500 hover:underline">
            Trocar senha
          </button>
          <button onClick={logout} className="text-sm text-gray-500 hover:underline">
            Sair
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside
          className={`${selectedConversation ? 'hidden' : 'block'} w-full space-y-4 overflow-y-auto border-r border-gray-200 p-3 md:block md:w-64`}
        >
          <button
            onClick={() => setStartingConversation(true)}
            className="w-full rounded bg-green-600 px-3 py-2 text-sm text-white"
          >
            Iniciar conversa
          </button>
          <div className="flex rounded border border-gray-200">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`flex-1 px-2 py-2 text-xs font-medium ${
                  activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab.label}
                <TabBadge count={tabCounts[tab.value]} />
              </button>
            ))}
          </div>
          {activeTab === 'inProgress' && <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />}
          {activeTab === 'waiting' && (
            <QueueList
              conversations={waitingConversations}
              onSelect={setSelectedId}
              title="Espera"
              emptyMessage="Nenhuma conversa aguardando."
            />
          )}
          {activeTab === 'automation' && (
            <QueueList
              conversations={automationConversations}
              onSelect={setSelectedId}
              title="Automação"
              emptyMessage="Nenhuma conversa em triagem automática."
            />
          )}
          <TeamPanel />
        </aside>
        <main className={`${selectedConversation ? 'block' : 'hidden'} flex-1 md:block`}>
          {selectedConversation ? (
            <ConversationView
              conversation={selectedConversation}
              onTransferClick={setTransferringId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-gray-400">
              Selecione uma conversa na lista ao lado.
            </p>
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
