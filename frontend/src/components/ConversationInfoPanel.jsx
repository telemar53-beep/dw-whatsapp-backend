import ContactAvatar from './ContactAvatar';

function getStatusMeta(conversation) {
  if (conversation.status === 'closed' || conversation.closedAt) {
    return { label: 'Encerrado', className: 'bg-wa-active text-wa-muted' };
  }
  if (conversation.triageState === 'pending' && conversation.status !== 'silent') {
    return { label: 'Na automação', className: 'bg-wa-link/15 text-wa-link' };
  }
  if (conversation.status === 'waiting') {
    return { label: 'Em espera', className: 'bg-wa-warn-bg text-wa-warn-text' };
  }
  if (conversation.status === 'assigned') {
    return { label: 'Em andamento', className: 'bg-wa-link/15 text-wa-link' };
  }
  return { label: 'Conversa', className: 'bg-wa-active text-wa-muted' };
}

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] leading-[16px] text-wa-muted">{label}</span>
      <span className="text-[14px] leading-[19px] font-medium text-wa-text">{value}</span>
    </div>
  );
}

function ConversationInfoPanel({ conversation }) {
  const displayName = conversation.contactDisplayName || conversation.contactPhoneNumber || 'Conversa';
  const status = getStatusMeta(conversation);
  const closedAtLabel = conversation.closedAt
    ? new Date(conversation.closedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <aside className="hidden w-[272px] shrink-0 flex-col overflow-y-auto border-l border-wa-surface-line bg-wa-surface-soft px-6 py-8 md:flex">
      <div className="flex flex-col items-center text-center">
        <div className="rounded-full ring-4 ring-wa-green/25">
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={conversation.contactDisplayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={88}
          />
        </div>
        <h2 className="mt-4 font-display text-[17px] font-semibold leading-[22px] text-wa-text">{displayName}</h2>
        {conversation.contactPhoneNumber && (
          <p className="mt-1 text-[13px] leading-[18px] text-wa-muted">{conversation.contactPhoneNumber}</p>
        )}
        <span className={`mt-3 rounded-full px-3 py-1 text-[12px] font-medium ${status.className}`}>{status.label}</span>
      </div>

      <div className="my-6 border-t border-wa-border" />

      <div className="flex flex-col gap-4">
        <InfoRow label="Cidade" value={conversation.contactCityName || 'Não informada'} />
        <InfoRow label="Setor" value={conversation.sectorName || 'Não definido'} />
        <InfoRow label="Atendente" value={conversation.assignedAgentName || 'Não atribuído'} />
        {closedAtLabel && <InfoRow label="Encerrado em" value={closedAtLabel} />}
      </div>
    </aside>
  );
}

export default ConversationInfoPanel;
