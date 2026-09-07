function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5l3.5 3.5L16 5.5" />
    </svg>
  );
}

function MessageStatusTicks({ status }) {
  if (status === 'failed') {
    return (
      <span title="Falha ao enviar" className="text-xs font-bold text-red-500">
        !
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span title="Enviado" className="inline-flex text-gray-400">
        <CheckIcon />
      </span>
    );
  }

  if (status === 'delivered' || status === 'read') {
    const colorClass = status === 'read' ? 'text-teal-signal' : 'text-gray-400';
    const label = status === 'read' ? 'Lido' : 'Entregue';
    return (
      <span title={label} className={`inline-flex -space-x-2 ${colorClass}`}>
        <CheckIcon />
        <CheckIcon />
      </span>
    );
  }

  return null;
}

export default MessageStatusTicks;
