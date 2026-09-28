import { useId } from 'react';
import { Dialog } from './Dialog';

// Substitui o `window.alert`. A semântica é a mesma de propósito: é modal e
// exige reconhecimento explícito. Um banner ou um toast seria mais discreto —
// e é justamente por isso que não serve aqui: "não foi possível assumir este
// atendimento" é coisa que o atendente precisa ter visto, não ter passado.
//
// `tom`: 'informativo' (padrão), 'sucesso' ou 'erro'. A frase diz o que
// houve; o tom só dá o ponto de cor ao lado do título (dialogo-claro.css).
export function AlertDialog({ open, title = 'Aviso', message, confirmLabel = 'Entendi', tom = 'informativo', onClose }) {
  const id = useId();
  const tituloId = `${id}-titulo`;
  const messageId = `${id}-mensagem`;

  if (!open) return null;

  return (
    <Dialog
      claro
      role="alertdialog"
      variant="alert"
      size=""
      labelledBy={tituloId}
      describedBy={messageId}
      onClose={onClose}
      // Não fecha por clique no fundo nem tem "x": a saída é reconhecer.
      dismissible={false}
      closeOnBackdrop={false}
      className="mc-pequeno"
    >
      <div className="mc-aviso" data-tom={tom}>
        <h2 id={tituloId} className="mc-aviso-titulo">{title}</h2>
        <p id={messageId} className="mc-aviso-texto">{message}</p>
      </div>
      <div className="mc-rodape is-aviso">
        <div className="mc-acoes">
          <button type="button" data-autofocus="" className="mc-botao is-principal" onClick={onClose}>{confirmLabel}</button>
        </div>
      </div>
    </Dialog>
  );
}
