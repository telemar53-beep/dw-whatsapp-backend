import ConversationListItem from './ConversationListItem';

function QueueList({ conversations, onSelect, onQuickClose, emptyMessage = 'Nenhuma conversa aguardando.', selectedId }) {
  if (conversations.length === 0) {
    return <p className="px-6 py-10 text-center text-[14px] leading-[20px] text-chat-faint">{emptyMessage}</p>;
  }

  return (
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
  );
}

export default QueueList;
