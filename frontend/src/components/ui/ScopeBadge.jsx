const LABELS = {
  global: () => 'Toda a operação',
  channel: () => 'Este canal',
  inherited: (detail) => `Herdado de ${detail}`,
  depends: (detail) => `Depende de ${detail}`,
};

export function ScopeBadge({ scope, detail }) {
  const label = (LABELS[scope] || LABELS.global)(detail);
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-wa-border bg-wa-surface-soft px-2.5 py-[3px] text-[12px] font-medium text-wa-muted">
      {label}
    </span>
  );
}
