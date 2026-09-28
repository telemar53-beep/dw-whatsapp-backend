import { memo, useCallback, useEffect, useState } from 'react';
import { Dialog, prenderTabEm } from '../ui/Dialog';
import ConversationView from '../ConversationView';
import { VARIANTE_DA_SUPERVISAO, EncaixeDoCabecalho, useCelular } from './ConversaDaSupervisao';
// A folha clara da conversa aprovada (a da mesa), direto, e não pelo módulo
// ConversaDaMesa: importar o módulo o tiraria do trecho da mesa.
import '../conversa-mesa.css';
import './popup-da-supervisao.css';

// O popup de conversa da Supervisão (2ª fatia): claro, com um cabeçalho só,
// a conversa larga à esquerda e os Dados do cliente à direita; no celular,
// tela cheia. Chega sob demanda — este módulo é o ponto de corte na página,
// e com ele vêm a conversa, o compositor e os painéis.
//
// Não é uma segunda conversa: é a ConversationView da mesa (com a variante da
// Supervisão e a folha clara da conversa aprovada, `.mesa-conversa`). O
// modal dos Encerrados continua no ConversationModal, como estava.
//
// memo com comparação rasa: a página passa a conversa com a mesma referência
// enquanto o evento for de outra conversa, e callbacks estáveis — o popup
// fica parado (a mesma fronteira do A2 da mesa).

// O encaixe do cabeçalho nasce junto com o popup, fora do React, e entra no
// topo do diálogo pelo ref. Com ele já existindo no primeiro render, o
// cabeçalho vai por portal na mesma passada — sem um segundo render do popup
// inteiro só para descobrir onde desenhar.
function criarEncaixe() {
  if (typeof document === 'undefined') return null;
  const no = document.createElement('div');
  no.className = 'sp-cab-encaixe';
  return no;
}

function PopupDaSupervisao({ conversation, onClose, onTransferClick, onContatoSalvo }) {
  // No celular, um painel (Dados do cliente ou SGP) pode ocupar o lugar da
  // conversa. Nesse estado o Escape volta para a conversa em vez de fechar o
  // popup (e o cabeçalho sai de cena: ver ConversaDaSupervisao).
  const [painelNoLugar, setPainelNoLugar] = useState(false);
  const [encaixe] = useState(criarEncaixe);
  const prenderEncaixe = useCallback((no) => {
    if (no && encaixe && encaixe.parentNode !== no) no.appendChild(encaixe);
  }, [encaixe]);
  const nome = conversation.contactDisplayName || conversation.contactPhoneNumber || 'cliente';
  // Um critério só para "celular" (a tela, ≤ 767 px): o mesmo do cabeçalho e
  // do CSS. Nele os painéis sempre ocupam o lugar da conversa — medir só a
  // largura da conversa deixava o painel ao lado entre 721 e 767 px, com o
  // cabeçalho já de celular.
  const celular = useCelular();

  // Escape com Emojis ou Respostas rápidas abertos é do compositor: fecha só o
  // popover. A pilha de diálogos ouve o Escape antes dele e fecharia o popup
  // inteiro, com o rascunho junto. Na captura, antes da pilha, o Escape é
  // marcado como tratado (a pilha ignora os marcados) e segue até o
  // compositor, que fecha o popover. Só vale com o popup no topo: um diálogo
  // aberto por cima continua dono do Escape.
  useEffect(() => {
    function aoTeclar(evento) {
      if (evento.key !== 'Escape' || evento.defaultPrevented || !encaixe) return;
      const painel = encaixe.closest('[data-dialog]');
      if (!painel) return;
      const dialogos = document.querySelectorAll('[data-dialog]');
      if (dialogos[dialogos.length - 1] !== painel) return;
      if (!painel.querySelector('#composer-emojis, #composer-respostas')) return;
      evento.preventDefault();
    }
    document.addEventListener('keydown', aoTeclar, true);
    return () => document.removeEventListener('keydown', aoTeclar, true);
  }, [encaixe]);

  // Com um painel no lugar da conversa, o cabeçalho e a coluna da conversa
  // estão escondidos, mas a prisão do Tab do diálogo os conta (ela não mede
  // caixa). Aqui o Tab gira só entre o que está à vista; nos outros casos, a
  // prisão do diálogo segue sozinha.
  const prenderNoVisivel = useCallback((evento) => {
    if (!painelNoLugar) return;
    prenderTabEm(evento.currentTarget.closest('[data-dialog]'), evento);
  }, [painelNoLugar]);

  return (
    <Dialog
      variant="supervisao-conversa"
      size=""
      ariaLabel={`Conversa com ${nome}`}
      // Superfície de leitura e trabalho: o foco inicial é o próprio diálogo,
      // e não o primeiro botão (no celular, nem o teclado sobe).
      initialFocus="dialog"
      onClose={onClose}
      // O fechar é do cabeçalho (seta no celular, "Fechar" no desktop).
      dismissible={false}
      closeOnEsc={!painelNoLugar}
      // Não fecha por clique no fundo: há uma caixa de mensagem aqui dentro, e
      // texto digitado e não enviado é trabalho que não pode sumir por engano.
      closeOnBackdrop={false}
      className="chat-workspace sp-popup"
    >
      <div ref={prenderEncaixe} className="sp-popup-topo" />
      {/* O onKeyDown aqui pega também o cabeçalho: ele vai por portal para o
          topo, mas no React continua filho da conversa. */}
      <div className="mesa-conversa sp-popup-corpo" onKeyDown={prenderNoVisivel}>
        <EncaixeDoCabecalho.Provider value={encaixe}>
          <ConversationView
            conversation={conversation}
            onTransferClick={onTransferClick}
            onBack={onClose}
            onContatoSalvo={onContatoSalvo}
            popup
            workspace
            painelModo={celular ? 'alternado' : 'coluna'}
            variante={VARIANTE_DA_SUPERVISAO}
            onPainelNoLugarChange={setPainelNoLugar}
          />
        </EncaixeDoCabecalho.Provider>
      </div>
    </Dialog>
  );
}

export default memo(PopupDaSupervisao);
