import { useState } from 'react';
import ConversationView from './ConversationView';
import { Dialog } from './ui/Dialog';

// Aberta a partir de "Encerrados" e da Supervisão — quase sempre por cima de
// outro diálogo. Tinha portal, backdrop, listener de ESC e z-index próprios, e
// era exatamente por isso que um único ESC fechava a conversa E a lista que a
// abriu. Agora é um diálogo como os outros: a pilha resolve camada, ESC e foco.
//
// Os dados do cliente moram dentro da conversa (`popup`): o mesmo painel da
// mesa, à vista quando há espaço e, no celular, no lugar da conversa. Antes
// eram um painel escuro à parte, que sumia abaixo de 768 px.
// `onContatoSalvo`: a página que abriu o popup (Supervisão, Encerrados) guarda
// na lista dela o que o "Editar cliente" salvou — reabrir não traz o antigo.
function ConversationModal({ conversation, onClose, onTransferClick, onContatoSalvo }) {
  // No celular, um painel (Dados do cliente ou SGP) pode ocupar o lugar da
  // conversa. Nesse estado o único controle é o voltar do painel: o fechar do
  // popup sai de cena e o ESC volta para a conversa em vez de fechar tudo.
  // Com a conversa à vista (e sempre no desktop), o popup fecha como antes.
  const [painelNoLugar, setPainelNoLugar] = useState(false);
  return (
    <Dialog
      variant="conversation"
      orientation="row"
      size="max-w-6xl"
      ariaLabel="Conversa"
      // Superficie de leitura e trabalho, nao formulario: o foco inicial e o
      // proprio dialogo, e nao o primeiro campo que aparecer no painel lateral.
      initialFocus="dialog"
      onClose={onClose}
      dismissible={!painelNoLugar}
      closeOnEsc={!painelNoLugar}
      closeLabel="Fechar conversa"
      // Não fecha por clique no fundo: há uma caixa de mensagem aqui dentro, e
      // texto digitado e não enviado é trabalho que não pode sumir por engano.
      closeOnBackdrop={false}
      className="chat-workspace"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationView conversation={conversation} onTransferClick={onTransferClick} onBack={onClose} onContatoSalvo={onContatoSalvo} popup onPainelNoLugarChange={setPainelNoLugar} />
      </div>
    </Dialog>
  );
}

export default ConversationModal;
