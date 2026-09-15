export function DangerZone({ title = 'Ações com cuidado', description, children }) {
  return (
    <section aria-labelledby="danger-zone-title" className="rounded-2xl border border-wa-error-text/25 bg-wa-surface-soft p-6">
      <h2 id="danger-zone-title" className="font-display text-[15px] font-semibold text-wa-error-text">
        {title}
      </h2>
      {description && <p className="mt-1 text-[13px] text-wa-muted">{description}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
