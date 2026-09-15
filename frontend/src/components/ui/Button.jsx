import { forwardRef } from 'react';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[14px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const VARIANTS = {
  primary: 'bg-wa-green text-white hover:bg-wa-green-dark focus-visible:outline-wa-green',
  secondary: 'border border-wa-border bg-wa-field text-wa-text hover:bg-wa-panel focus-visible:outline-wa-green',
  danger: 'border border-wa-error-text/30 bg-wa-error-bg text-wa-error-text hover:brightness-110 focus-visible:outline-wa-error-text',
  ghost: 'text-wa-muted hover:bg-wa-hover hover:text-wa-text focus-visible:outline-wa-green',
};

export const Button = forwardRef(function Button({ variant = 'primary', loading = false, type = 'button', className = '', children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANTS[variant] || VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
