import ConversationListItem from './ConversationListItem';
import { AsyncState } from './ui';

function QueueList({ conversations, status, onSelect, onQuickClose, emptyMessage = 'Nenhum atendimento em espera.', selectedId, unreadIds, compact = false, rail = false }) {
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
            unread={Boolean(unreadIds && unreadIds.has(conversation.id))}
            showArrivalTime
            compact={compact}
            rail={rail}
          />
        ))}
      </ul>
    </AsyncState>
  );
}

export default QueueList;
