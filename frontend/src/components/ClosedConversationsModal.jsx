import { useState } from 'react';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import ClosedConversationsList from './ClosedConversationsList';
import ConversationModal from './ConversationModal';
import WaDialog from './WaDialog';

function ClosedConversationsModal({ onClose }) {
  const { items, hasMore, loading, status, loadMore, refresh, erroAoCarregarMais } = useMyClosedConversations();
  const [selectedConversation, setSelectedConversation] = useState(null);

  return (
    <>
      <WaDialog variant="closed" title={<>Encerrados{items.length > 0 && <span className="dialog-closed-count" title={hasMore ? 'Atendimentos carregados; há mais registros disponíveis' : 'Atendimentos encerrados'}>{items.length}{hasMore ? '+' : ''}</span>}</>} onClose={onClose} closeOnBackdrop size="max-w-[1500px]">
        <div className="dialog-closed-content wa-scroll min-h-0 overflow-y-auto">
          <ClosedConversationsList
            conversations={items}
            status={status}
            onSelect={setSelectedConversation}
            selectedId={selectedConversation?.id}
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
            onRetry={refresh}
            erroAoCarregarMais={erroAoCarregarMais}
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
