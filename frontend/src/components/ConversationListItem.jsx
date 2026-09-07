import ContactAvatar from './ContactAvatar';

function ConversationListItem({ conversation, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(conversation.id)}
        className="flex w-full items-center gap-2 rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
      >
        <ContactAvatar
          contactId={conversation.contactId}
          avatarPath={conversation.contactAvatarPath}
          displayName={conversation.contactDisplayName}
          phoneNumber={conversation.contactPhoneNumber}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-gray-800">
              {conversation.contactDisplayName || conversation.contactPhoneNumber}
            </p>
            {conversation.sectorName && (
              <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{conversation.sectorName}</span>
            )}
          </div>
          <p className="text-xs text-gray-500">{conversation.contactPhoneNumber}</p>
        </div>
      </button>
    </li>
  );
}

export default ConversationListItem;
