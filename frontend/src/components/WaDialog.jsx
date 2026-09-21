import { Dialog } from './ui/Dialog';

// Este arquivo deixou de ser a base dos diálogos: agora é um adaptador fino
// sobre `ui/Dialog`. A assinatura continua idêntica de propósito — são 22
// pontos de uso e dez arquivos importando as classes abaixo. Nenhum deles
// precisou mudar para ganhar rótulo acessível, foco, trap, ESC por pilha e
// clique fora à prova de arrasto. Código novo usa `ui/Dialog` direto.

export const waInputClass =
  'w-full rounded-[10px] bg-wa-panel-header px-3.5 py-2.5 text-[14.5px] text-wa-text outline-none transition-colors placeholder:text-wa-muted focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-accent/60';

export const waLabelClass = 'mb-1.5 block text-[13px] font-medium text-wa-muted';

export const waPrimaryButtonClass =
  'rounded-[12px] bg-accent px-6 py-2 text-[14px] font-medium text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50';

export const waGhostButtonClass =
  'rounded-[12px] px-6 py-2 text-[14px] font-medium text-wa-icon transition-colors hover:bg-wa-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

export const waErrorClass = 'rounded-[10px] bg-wa-error-bg px-3 py-2 text-[13.5px] text-wa-error-text';

// Mesmo contrato que `ui/Field` já aplica no erro de campo: `role="alert"` para
// o erro e `role="status"` para a confirmação. Vinte pontos da aplicação
// montavam a faixa à mão com `waErrorClass` e ficavam MUDOS — medido na
// auditoria: com "As senhas não coincidem" na tela, a consulta por
// `[aria-live],[role=status],[role=alert]` devolvia lista vazia. Não é um
// segundo sistema de mensagem: é o mesmo, num componente em vez de uma classe
// solta, para o papel não depender de cada tela lembrar de escrevê-lo.
export function WaError({ className = '', children, ...rest }) {
  return <p role="alert" className={`${waErrorClass} ${className}`.trim()} {...rest}>{children}</p>;
}

export function WaSuccess({ className = '', children, ...rest }) {
  return <p role="status" className={`text-[13.5px] text-wa-muted ${className}`.trim()} {...rest}>{children}</p>;
}

function WaDialog(props) {
  // `closeOnBackdrop` nasce falso: antes QUALQUER clique no fundo fechava
  // qualquer diálogo, inclusive um formulário preenchido. Quem é de leitura
  // pede a permissão de volta explicitamente.
  return <Dialog {...props} />;
}

export default WaDialog;
