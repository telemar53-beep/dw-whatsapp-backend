import { forwardRef } from 'react';

const BASE =
  'inline-flex items-center justify-center font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

// `md` reproduz exatamente o botão que existe hoje — trocar o padrão mudaria a
// altura de todo controle do produto de uma vez. `sm`, `lg` e `icon` existem
// para que as telas parem de improvisar com `!py-*` e classes soltas; a adoção
// acontece quando cada área for tratada, não aqui.
const SIZES = {
  sm: 'gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px]',
  md: 'gap-2 rounded-[12px] px-4 py-2.5 text-[14px]',
  lg: 'gap-2 rounded-[12px] px-5 py-3 text-[14px]',
  icon: 'gap-0 rounded-[10px] h-8 w-8 p-0 text-[13px]',
};
const VARIANTS = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong focus-visible:outline-focus-ring',
  secondary: 'border border-wa-border bg-wa-field text-wa-text hover:bg-wa-panel focus-visible:outline-focus-ring',
  danger: 'border border-wa-error-text/30 bg-wa-error-bg text-wa-error-text hover:brightness-110 focus-visible:outline-focus-ring',
  ghost: 'text-wa-muted hover:bg-wa-hover hover:text-wa-text focus-visible:outline-focus-ring',
};

export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', loading = false, type = 'button', className = '', children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      // Marca a acao destrutiva para que o foco inicial de um dialogo nunca caia nela.
      data-danger={variant === 'danger' ? '' : undefined}
      disabled={disabled || loading}
      className={`${BASE} ${SIZES[size] || SIZES.md} ${VARIANTS[variant] || VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
