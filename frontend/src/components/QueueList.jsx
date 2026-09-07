import ConversationListItem from './ConversationListItem';

function QueueList({ conversations, onSelect, title = 'Fila de espera', emptyMessage = 'Nenhuma conversa aguardando.' }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-700">{title}</h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conversation) => (
            <ConversationListItem key={conversation.id} conversation={conversation} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default QueueList;
