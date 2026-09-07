function ConversationListItem({ conversation, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-gray-800">
            {conversation.contactDisplayName || conversation.contactPhoneNumber}
          </p>
          {conversation.sectorName && (
            <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{conversation.sectorName}</span>
          )}
        </div>
        <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
      </button>
    </li>
  );
}

export default ConversationListItem;
