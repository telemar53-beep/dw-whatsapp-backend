function CityStatusDot({ enabled }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-wa-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-wa-chip-text' : 'bg-wa-border-strong'}`} aria-hidden="true" />
      {enabled ? 'Ativo' : 'Inativo'}
    </span>
  );
}

export default CityStatusDot;
