import ConversationListItem from './ConversationListItem';

function MyConversationsList({ conversations, onSelect, unreadIds, selectedId }) {
  if (conversations.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-[14px] leading-[20px] text-chat-faint">Nenhuma conversa atribuída.</p>
    );
  }

  return (
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
  );
}

export default MyConversationsList;
