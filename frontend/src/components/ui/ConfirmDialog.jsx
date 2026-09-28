import { useId } from 'react';
import { Dialog } from './Dialog';

// A API externa não mudou: `useConfirm` e os arquivos que o usam seguem
// iguais. Por dentro, desde o Bloco 1 (28/09): moldura clara e sólida, sem o
// ícone em ladrilho (ele repetia o que o botão vermelho já diz), e o
// destrutivo com o verbo escrito — a cor só reforça.
//
// `ocupado` e `erro` são da confirmação que espera a resposta (A4-4, ver
// useConfirm): enquanto a ação corre, as saídas ficam presas e o botão diz o
// que está acontecendo; se ela falha, o erro aparece aqui dentro e o diálogo
// continua aberto para tentar de novo ou desistir.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  busyLabel = 'Aguarde…',
  danger = false,
  ocupado = false,
  erro = null,
  onConfirm,
  onCancel,
}) {
  const id = useId();
  const tituloId = `${id}-titulo`;
  const messageId = `${id}-mensagem`;

  if (!open) return null;

  return (
    <Dialog
      claro
      role="alertdialog"
      variant="confirm"
      size=""
      labelledBy={title ? tituloId : undefined}
      ariaLabel={title ? undefined : message}
      describedBy={messageId}
      // Sem "x": Cancelar ja e a saida explicita, e dois jeitos de dizer nao
      // lado a lado so criam duvida sobre a diferenca entre eles.
      dismissible={false}
      onClose={onCancel}
      closeOnEsc={!ocupado}
      // Confirmação não fecha por clique no fundo: é decisão, não leitura.
      closeOnBackdrop={false}
      className="mc-pequeno"
    >
      <div className="mc-aviso" data-tom={danger ? 'destrutivo' : 'informativo'}>
        {title && <h2 id={tituloId} className="mc-aviso-titulo">{title}</h2>}
        <p id={messageId} className="mc-aviso-texto">{message}</p>
        {erro && <p role="alert" className="mc-erro">{erro}</p>}
      </div>
      <div className="mc-rodape is-aviso">
        <div className="mc-acoes">
          {/* O foco inicial é a saída segura, nunca a ação destrutiva. */}
          <button type="button" data-autofocus="" className="mc-botao" onClick={onCancel} disabled={ocupado}>
            {cancelLabel}
          </button>
          {/* Ocupado, o botão continua focável (aria-disabled, e não
              disabled): tirar o foco dele no meio do envio o jogaria para
              fora do diálogo. Quem barra o segundo clique é o useConfirm. */}
          <button
            type="button"
            className={`mc-botao ${danger ? 'is-perigo' : 'is-principal'}`}
            // O mesmo marcador do ui/Button: ação destrutiva nunca recebe o
            // foco inicial (ui/Dialog).
            data-danger={danger ? '' : undefined}
            onClick={onConfirm}
            aria-disabled={ocupado ? 'true' : undefined}
          >
            {ocupado ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
