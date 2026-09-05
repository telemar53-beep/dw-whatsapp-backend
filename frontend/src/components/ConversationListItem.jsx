function ConversationListItem({ conversation, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <p className="font-medium text-gray-800">
          {conversation.contactDisplayName || conversation.contactPhoneNumber}
        </p>
        <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
      </button>
    </li>
  );
}

export default ConversationListItem;
