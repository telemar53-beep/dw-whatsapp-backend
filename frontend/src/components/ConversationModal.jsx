import ConversationView from './ConversationView';
import WaDialog from './WaDialog';

function ConversationModal({ conversation, onClose, onTransferClick }) {
  return (
    <WaDialog onClose={onClose} size="max-w-5xl">
      <div className="flex min-h-0 flex-1">
        <ConversationView conversation={conversation} onTransferClick={onTransferClick} onBack={onClose} />
      </div>
    </WaDialog>
  );
}

export default ConversationModal;
