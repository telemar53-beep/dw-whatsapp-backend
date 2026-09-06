import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';
import ChangePasswordModal from '../components/ChangePasswordModal';
import StartConversationModal from '../components/StartConversationModal';
import TeamPanel from '../components/TeamPanel';

function DashboardPage() {
  const { agent, logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const [selectedId, setSelectedId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [pendingConversation, setPendingConversation] = useState(null);

  const selectedConversation =
    [...queue, ...myConversations].find((c) => c.id === selectedId) ||
    (pendingConversation && pendingConversation.id === selectedId ? pendingConversation : null);

  useEffect(() => {
    if (pendingConversation && [...queue, ...myConversations].some((c) => c.id === pendingConversation.id)) {
      setPendingConversation(null);
    }
  }, [queue, myConversations, pendingConversation]);

  return (
    <div className="flex h-screen flex-col">
      <div className={selectedConversation ? 'hidden md:block' : ''}>
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
          <QueueList conversations={queue} onSelect={setSelectedId} />
          <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />
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
