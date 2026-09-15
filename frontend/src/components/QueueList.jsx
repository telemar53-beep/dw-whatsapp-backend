import ConversationListItem from './ConversationListItem';
import { AsyncState } from './ui';

function QueueList({ conversations, status, onSelect, onQuickClose, emptyMessage = 'Nenhum atendimento em espera.', selectedId }) {
  return (
    <AsyncState status={status} isEmpty={conversations.length === 0} emptyMessage={emptyMessage}>
      <ul>
        {conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            onSelect={onSelect}
            onQuickClose={onQuickClose}
            selected={selectedId === conversation.id}
          />
        ))}
      </ul>
    </AsyncState>
  );
}

export default QueueList;
