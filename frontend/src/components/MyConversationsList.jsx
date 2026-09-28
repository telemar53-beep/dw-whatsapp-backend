import ConversationListItem from './ConversationListItem';
import LinhaDaMesa from './LinhaDaMesa';
import { AsyncState } from './ui';

function MyConversationsList({ conversations, status, onSelect, unreadIds, selectedId, compact = false, rail = false, variante }) {
  // Na mesa, a linha é a da mesa; no modo rail (72px) continua a do
  // ConversationListItem, que só mostra o avatar.
  const Linha = variante === 'mesa' && !rail ? LinhaDaMesa : ConversationListItem;
  return (
    <AsyncState status={status} isEmpty={conversations.length === 0} emptyMessage={<span className="block px-4 pt-4 text-center">Nenhum atendimento em andamento.</span>}>
      <ul>
        {conversations.map((conversation) => (
          <Linha
            key={conversation.id}
            conversation={conversation}
            onSelect={onSelect}
            unread={Boolean(unreadIds && unreadIds.has(conversation.id))}
            selected={selectedId === conversation.id}
            compact={compact}
            rail={rail}
          />
        ))}
      </ul>
    </AsyncState>
  );
}

export default MyConversationsList;
