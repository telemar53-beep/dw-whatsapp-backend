export function Toggle({ id, checked, onChange, label, description, disabled = false, disabledReason }) {
  const reasonId = disabled && disabledReason ? `${id}-reason` : null;
  const descId = description ? `${id}-desc` : null;
  const describedBy = [descId, reasonId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={describedBy}
        className="mt-[3px] h-4 w-4 shrink-0 accent-wa-green"
      />
      <div className="min-w-0">
        <label htmlFor={id} className={`block text-[14px] ${disabled ? 'text-wa-muted' : 'text-wa-text'}`}>
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-[12.5px] leading-[17px] text-wa-muted">
            {description}
          </p>
        )}
        {reasonId && (
          <p id={reasonId} className="mt-0.5 text-[12.5px] leading-[17px] text-wa-warn-text">
            {disabledReason}
          </p>
        )}
      </div>
    </div>
  );
}
