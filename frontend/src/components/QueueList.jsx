import ConversationListItem from './ConversationListItem';

function QueueList({ conversations, onSelect, emptyMessage = 'Nenhuma conversa aguardando.', selectedId }) {
  if (conversations.length === 0) {
    return <p className="px-6 py-10 text-center text-[14px] leading-[20px] text-ink-950/50">{emptyMessage}</p>;
  }

  return (
    <ul>
      {conversations.map((conversation) => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          onSelect={onSelect}
          selected={selectedId === conversation.id}
        />
      ))}
    </ul>
  );
}

export default QueueList;
