import { useState } from 'react';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import ClosedConversationsList from './ClosedConversationsList';
import ConversationModal from './ConversationModal';
import WaDialog from './WaDialog';

function ClosedConversationsModal({ onClose }) {
  const { items, hasMore, loading, status, loadMore } = useMyClosedConversations();
  const [selectedConversation, setSelectedConversation] = useState(null);

  return (
    <>
      <WaDialog title="Atendimentos encerrados" onClose={onClose} size="max-w-[1500px]">
        <div className="wa-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
          <ClosedConversationsList
            conversations={items}
            status={status}
            onSelect={setSelectedConversation}
            selectedId={selectedConversation?.id}
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
          />
        </div>
      </WaDialog>
      {selectedConversation && (
        <ConversationModal
          conversation={selectedConversation}
          onClose={() => setSelectedConversation(null)}
          onTransferClick={() => {}}
        />
      )}
    </>
  );
}

export default ClosedConversationsModal;
