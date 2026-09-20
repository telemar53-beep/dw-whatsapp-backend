import { cloneElement, Children } from 'react';

// Largura declarada no campo, pelo dado que ele guarda. O padrão é `full`,
// idêntico ao que existe hoje: nada muda enquanto cada tela não escolher.
// Enquanto os campos não declararem, os caps globais de `index.css` e
// `settings.css` continuam sendo o que segura os numéricos — remover aqueles
// hacks antes disso jogaria todo input curto para 100%.
const LARGURAS = {
  xs: 'max-w-[96px]',
  sm: 'max-w-[180px]',
  md: 'max-w-[320px]',
  full: '',
};

export function Field({ id, label, help, error, width = 'full', children }) {
  const helpId = help ? `${id}-help` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const child = Children.only(children);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
        {label}
      </label>
      {cloneElement(child, {
        'aria-describedby': describedBy,
        'aria-invalid': error ? 'true' : undefined,
        className: [child.props.className, LARGURAS[width] || ''].filter(Boolean).join(' '),
      })}
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
