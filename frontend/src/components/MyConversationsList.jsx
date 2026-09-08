import ConversationListItem from './ConversationListItem';

function MyConversationsList({ conversations, onSelect, unreadIds }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">Minhas conversas</h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma conversa atribuída.</p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              onSelect={onSelect}
              unread={Boolean(unreadIds && unreadIds.has(conversation.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default MyConversationsList;
