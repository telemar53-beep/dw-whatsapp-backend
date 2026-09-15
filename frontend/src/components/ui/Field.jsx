import { cloneElement, Children } from 'react';

export function Field({ id, label, help, error, children }) {
  const helpId = help ? `${id}-help` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const child = Children.only(children);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
        {label}
      </label>
      {cloneElement(child, { 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {help && (
        <p id={helpId} className="mt-1.5 text-[12.5px] leading-[17px] text-wa-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-[12.5px] leading-[17px] text-wa-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
