import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import QueueList from '../components/QueueList';
import MyConversationsList from '../components/MyConversationsList';
import ConversationView from '../components/ConversationView';
import TransferModal from '../components/TransferModal';
import ChannelStatusBanner from '../components/ChannelStatusBanner';

function DashboardPage() {
  const { logout } = useAuth();
  const queue = useQueue();
  const myConversations = useMyConversations();
  const [selectedId, setSelectedId] = useState(null);
  const [transferringId, setTransferringId] = useState(null);

  const selectedConversation = [...queue, ...myConversations].find((c) => c.id === selectedId) || null;

  return (
    <div className="flex h-screen flex-col">
      <ChannelStatusBanner />
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h1 className="font-semibold text-gray-800">DW Telecom - Atendimento</h1>
        <button onClick={logout} className="text-sm text-gray-500 hover:underline">
          Sair
        </button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 space-y-4 overflow-y-auto border-r border-gray-200 p-3">
          <QueueList conversations={queue} onSelect={setSelectedId} />
          <MyConversationsList conversations={myConversations} onSelect={setSelectedId} />
        </aside>
        <main className="flex-1">
          {selectedConversation ? (
            <ConversationView conversation={selectedConversation} onTransferClick={setTransferringId} />
          ) : (
            <p className="flex h-full items-center justify-center text-gray-400">
              Selecione uma conversa na lista ao lado.
            </p>
          )}
        </main>
      </div>
      {transferringId && <TransferModal conversationId={transferringId} onClose={() => setTransferringId(null)} />}
    </div>
  );
}

export default DashboardPage;
