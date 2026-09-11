import QueueList from './QueueList';

function ClosedConversationsList({ conversations, onSelect, selectedId, hasMore, loading, onLoadMore }) {
  function handleSelect(id) {
    const conversation = conversations.find((c) => c.id === id);
    if (conversation) onSelect(conversation);
  }

  return (
    <div>
      <QueueList
        conversations={conversations}
        onSelect={handleSelect}
        selectedId={selectedId}
        emptyMessage="Nenhum atendimento encerrado ainda."
      />
      {hasMore && (
        <div className="px-4 py-3 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="text-[14px] font-medium text-chat-orange hover:underline disabled:opacity-50"
          >
            Carregar mais
          </button>
        </div>
      )}
    </div>
  );
}

export default ClosedConversationsList;
