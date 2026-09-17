import ConversationListItem from './ConversationListItem';
import { AsyncState } from './ui';

function QueueList({ conversations, status, onSelect, onQuickClose, emptyMessage = 'Nenhum atendimento em espera.', selectedId }) {
  return (
    <AsyncState status={status} isEmpty={conversations.length === 0} emptyMessage={<span className="block px-4 pt-4 text-center">{emptyMessage}</span>}>
      <ul>
        {conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            onSelect={onSelect}
            onQuickClose={onQuickClose}
            selected={selectedId === conversation.id}
            showArrivalTime
          />
        ))}
      </ul>
    </AsyncState>
  );
}

export default QueueList;
