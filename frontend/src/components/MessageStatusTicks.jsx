function Tick({ className }) {
  return (
    <svg
      viewBox="0 0 12 11"
      width="12"
      height="11"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 5.9l3.1 3.3L10.6 1.4" />
    </svg>
  );
}

function MessageStatusTicks({ status }) {
  if (status === 'failed') {
    return (
      <span
        title="Falha ao enviar"
        className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold leading-none text-white"
      >
        !
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span title="Enviado" className="inline-flex shrink-0 text-white/60">
        <Tick />
      </span>
    );
  }

  if (status === 'delivered' || status === 'read') {
    // Entregue e lido usavam a MESMA cor, e a diferenca ficava so em um tique a
    // mais num glifo de 12px: pela lista, nao dava para saber se o cliente leu.
    const colorClass = status === 'read' ? 'text-chat-online' : 'text-white/60';
    const label = status === 'read' ? 'Lido' : 'Entregue';
    return (
      <span title={label} className={`inline-flex shrink-0 ${colorClass}`}>
        <Tick className="-mr-[6px]" />
        <Tick />
      </span>
    );
  }

  return null;
}

export default MessageStatusTicks;
