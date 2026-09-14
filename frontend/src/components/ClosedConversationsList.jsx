import ConversationListItem from './ConversationListItem';

function ClosedConversationsList({ conversations, onSelect, selectedId, hasMore, loading, onLoadMore }) {
  function handleSelect(id) {
    const conversation = conversations.find((c) => c.id === id);
    if (conversation) onSelect(conversation);
  }

  if (conversations.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13.5px] text-chat-faint">Nenhum atendimento encerrado ainda.</p>
    );
  }

  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>li]:overflow-clip [&>li]:rounded-[18px] [&>li]:border [&>li]:border-white/[0.07] [&>li]:bg-white/[0.08]">
        {conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            onSelect={handleSelect}
            selected={selectedId === conversation.id}
            divided={false}
          />
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="mt-3 w-full rounded-[16px] border border-white/[0.10] bg-white/[0.06] px-4 py-3 text-[14px] font-medium text-chat-text transition hover:bg-white/[0.10] disabled:opacity-50"
        >
          {loading ? 'Carregando...' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
}

export default ClosedConversationsList;
