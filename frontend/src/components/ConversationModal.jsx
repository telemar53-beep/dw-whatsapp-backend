import { useState } from 'react';
import ConversationView from './ConversationView';
import ConversationInfoPanel from './ConversationInfoPanel';
import { Dialog } from './ui/Dialog';
import { comContatoSalvo } from '../utils/contatoSalvo';

// Aberta a partir de "Encerrados" e da Supervisão — quase sempre por cima de
// outro diálogo. Tinha portal, backdrop, listener de ESC e z-index próprios, e
// era exatamente por isso que um único ESC fechava a conversa E a lista que a
// abriu. Agora é um diálogo como os outros: a pilha resolve camada, ESC e foco.
// `onContatoSalvo`: a página que abriu o popup (Supervisão, Encerrados) guarda
// na lista dela o que o "Editar cliente" salvou — reabrir não traz o antigo.
function ConversationModal({ conversation, onClose, onTransferClick, onContatoSalvo }) {
  // O painel ao lado recebe a conversa da lista, que não fica sabendo da
  // edição do contato. O que a conversa salvou chega aqui e vale para o painel
  // enquanto ele mostrar a mesma conversa e o mesmo contato.
  const [contatoSalvo, setContatoSalvo] = useState(null);
  function aoSalvarContato(salvo) {
    setContatoSalvo(salvo);
    if (onContatoSalvo) onContatoSalvo(salvo);
  }
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
      dismissible
      closeLabel="Fechar conversa"
      // Não fecha por clique no fundo: há uma caixa de mensagem aqui dentro, e
      // texto digitado e não enviado é trabalho que não pode sumir por engano.
      closeOnBackdrop={false}
      className="chat-workspace"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationView conversation={conversation} onTransferClick={onTransferClick} onBack={onClose} onContatoSalvo={aoSalvarContato} />
      </div>
      <ConversationInfoPanel conversation={comContatoSalvo(conversation, contatoSalvo)} />
    </Dialog>
  );
}

export default ConversationModal;
