import ConversationListItem from './ConversationListItem';
import { AsyncState } from './ui';

function MyConversationsList({ conversations, status, onSelect, unreadIds, selectedId }) {
  return (
    <AsyncState status={status} isEmpty={conversations.length === 0} emptyMessage={<span className="block px-4 pt-4 text-center">Nenhum atendimento em andamento.</span>}>
      <ul>
        {conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            onSelect={onSelect}
            unread={Boolean(unreadIds && unreadIds.has(conversation.id))}
            selected={selectedId === conversation.id}
          />
        ))}
      </ul>
    </AsyncState>
  );
}

export default MyConversationsList;
