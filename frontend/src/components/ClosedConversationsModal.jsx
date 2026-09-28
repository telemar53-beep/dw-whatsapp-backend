import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import ClosedConversationsList from './ClosedConversationsList';
import ConversationView from './ConversationView';
import ContactAvatar from './ContactAvatar';
import { Dialog, prenderTabEm } from './ui/Dialog';
import { CabecalhoClaro, useCelular } from './ui/DialogoClaro';
import { IconeConsultarSgp } from './icones';
import { IconeDadosCliente, IconeHistorico, IconeRecolher } from './icones/conversa';
// A folha clara da conversa aprovada (a da mesa), direto, como o popup da
// Supervisão: importar o módulo ConversaDaMesa o tiraria do trecho da mesa.
import './conversa-mesa.css';
import './encerrados.css';

// "Atendimentos encerrados" (Bloco 1): um diálogo só, claro, com a lista à
// esquerda e a conversa à direita (mestre–detalhe). Antes a conversa abria num
// segundo diálogo, escuro, por cima da lista. No celular: a lista primeiro;
// escolhida uma conversa, ela toma a tela com a seta "Voltar para a lista"
// como único controle.
//
// A conversa não é outra: é a ConversationView da mesa, com a folha clara
// aprovada (`.mesa-conversa`) e a variante daqui (cabeçalho e faixa de
// encerrado). Só de leitura porque a conversa está encerrada — a regra é a da
// ConversationView, não uma daqui. Dados do cliente e Histórico continuam os
// de sempre (o painel da conversa).
//
// Chega sob demanda (TrilhoDaMesa e SideNav), e a lista só é pedida com o
// diálogo aberto.

function pad(n) {
  return String(n).padStart(2, '0');
}

// "20/09/2026 às 12:00", na hora do navegador.
function dataCompleta(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return `${pad(data.getDate())}/${pad(data.getMonth() + 1)}/${data.getFullYear()} às ${pad(data.getHours())}:${pad(data.getMinutes())}`;
}

const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

// O cabeçalho da conversa aberta: quem é o cliente e de onde veio — e as
// consultas (Dados do cliente, Histórico, SGP). Sem Transferir nem Encerrar:
// o atendimento acabou. Some quando um painel ocupa o lugar da conversa
// (celular): aí o único controle é o voltar do painel.
function CabecalhoDosEncerrados({ conversation, displayName, nameLabel, telefone, onVoltar, onHistorico, sgp, cliente, painelNoLugar, dadosAoLado }) {
  const celular = useCelular();
  const dados = [
    telefone,
    conversation.channelName,
    conversation.protocolNumber ? `Protocolo ${conversation.protocolNumber}` : null,
  ].filter(Boolean);
  const atalhos = !dadosAoLado && (
    <>
      <button
        ref={cliente.ref}
        type="button"
        className="ae-acao"
        onClick={cliente.alternar}
        aria-expanded={cliente.aberto}
        aria-controls={cliente.aberto ? 'conv-painel-cliente' : undefined}
      >
        <IconeDadosCliente tamanho={18} />
        <span>Dados do cliente</span>
      </button>
      <button type="button" className="ae-acao" onClick={onHistorico}>
        <IconeHistorico tamanho={18} />
        <span>Histórico</span>
      </button>
    </>
  );

  return (
    <div className={celular ? 'ae-cab is-celular' : 'ae-cab'} hidden={painelNoLugar}>
      <div className="ae-cab-linha">
        {celular && (
          <button type="button" className="ae-cab-voltar" onClick={onVoltar} aria-label="Voltar para a lista" title="Voltar para a lista">
            <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
          </button>
        )}
        {/* A foto repete o nome: fica fora da leitura. */}
        <span className="ae-cab-avatar" aria-hidden="true">
          <ContactAvatar
            contactId={conversation.contactId}
            avatarPath={conversation.contactAvatarPath}
            displayName={displayName}
            phoneNumber={conversation.contactPhoneNumber}
            size={celular ? 36 : 40}
          />
        </span>
        <div className="ae-cab-id">
          <h3 className="ae-cab-nome" title={nameLabel}>{nameLabel}</h3>
          {dados.length > 0 && (
            <p className="ae-cab-dados">
              {dados.map((valor) => <span key={valor} title={valor}>{valor}</span>)}
            </p>
          )}
        </div>
        <div className="ae-cab-acoes">
          {!celular && atalhos}
          <button
            ref={sgp.ref}
            type="button"
            className={celular ? 'ae-acao is-icone' : 'ae-acao'}
            onClick={sgp.alternar}
            aria-label={celular ? 'Consultar SGP' : undefined}
            title={celular ? 'Consultar SGP' : undefined}
            aria-expanded={sgp.aberto}
            aria-controls={sgp.aberto ? 'conv-painel-sgp' : undefined}
          >
            <IconeConsultarSgp tamanho={18} />
            {!celular && <span>Consultar SGP</span>}
          </button>
        </div>
      </div>
      {celular && atalhos && <div className="ae-cab-atalhos">{atalhos}</div>}
    </div>
  );
}

// No lugar do compositor: quando o atendimento acabou. É um estado, não um
// controle desligado.
function RodapeDosEncerrados({ conversation }) {
  const quando = dataCompleta(conversation.closedAt);
  return (
    <div className="ae-faixa">
      <p>{quando ? `Atendimento encerrado em ${quando}.` : 'Atendimento encerrado.'}</p>
    </div>
  );
}

// Um objeto só, definido uma vez: a conversa recebe sempre o mesmo.
const VARIANTE_DOS_ENCERRADOS = Object.freeze({
  Cabecalho: CabecalhoDosEncerrados,
  Rodape: RodapeDosEncerrados,
});

// Encerrado não se transfere; a conversa pede a função mesmo assim.
const SEM_TRANSFERENCIA = () => {};

function ClosedConversationsModal({ onClose }) {
  const { items, hasMore, loading, status, loadMore, refresh, erroAoCarregarMais, aplicarContatoSalvo } = useMyClosedConversations();
  const celular = useCelular();
  const id = useId();
  const tituloId = `${id}-titulo`;
  // A conversa aberta vem da lista, pelo id: o que o "Editar cliente" salvou
  // vai para a lista (aplicarContatoSalvo), e reabrir parte dela.
  const [selecionadaId, setSelecionadaId] = useState(null);
  const selecionada = items.find((conversa) => conversa.id === selecionadaId) || null;
  // No celular, um painel (Dados do cliente ou SGP) pode ocupar o lugar da
  // conversa: aí o Escape é do painel, e o cabeçalho da conversa sai de cena.
  const [painelNoLugar, setPainelNoLugar] = useState(false);
  const naConversa = celular && Boolean(selecionada);
  const raizRef = useRef(null);
  const ultimaRef = useRef(null);

  const escolher = useCallback((conversa) => {
    ultimaRef.current = conversa.id;
    setSelecionadaId(conversa.id);
  }, []);
  const voltarParaLista = useCallback(() => {
    setPainelNoLugar(false);
    setSelecionadaId(null);
  }, []);

  // O foco acompanha a troca de tela no celular: entra na seta da conversa e,
  // na volta, cai na linha que tinha sido aberta.
  const estavaNaConversa = useRef(false);
  useEffect(() => {
    const raiz = raizRef.current;
    if (raiz && naConversa && !estavaNaConversa.current) {
      const voltar = raiz.querySelector('.ae-cab-voltar');
      if (voltar) voltar.focus();
    } else if (raiz && !naConversa && estavaNaConversa.current) {
      const linha = raiz.querySelector(`[data-conversa="${ultimaRef.current}"]`);
      if (linha) linha.focus();
    }
    estavaNaConversa.current = naConversa;
  }, [naConversa]);

  // Escape (e a saída do cabeçalho da lista): no celular, com a conversa na
  // tela, volta para a lista; senão fecha.
  function aoSair() {
    if (naConversa) voltarParaLista();
    else onClose();
  }

  // Com um painel no lugar da conversa, a prisão do Tab do diálogo contaria o
  // que está escondido: aqui ela gira só entre o que está à vista.
  const prenderNoVisivel = useCallback((evento) => {
    if (!painelNoLugar) return;
    prenderTabEm(evento.currentTarget.closest('[data-dialog]'), evento);
  }, [painelNoLugar]);

  const contagem = items.length > 0 && (
    <span className="ae-total" title={hasMore ? 'Atendimentos carregados; há mais registros disponíveis' : 'Atendimentos encerrados'}>
      <span className="sr-only">, </span>
      {items.length}{hasMore ? '+' : ''}
    </span>
  );

  let detalhe = null;
  if (selecionada && (!celular || naConversa)) {
    detalhe = (
      <div className="ae-conversa mesa-conversa" onKeyDown={prenderNoVisivel}>
        <ConversationView
          conversation={selecionada}
          onTransferClick={SEM_TRANSFERENCIA}
          onBack={voltarParaLista}
          onContatoSalvo={aplicarContatoSalvo}
          popup
          workspace
          painelModo={celular ? 'alternado' : 'coluna'}
          variante={VARIANTE_DOS_ENCERRADOS}
          onPainelNoLugarChange={setPainelNoLugar}
        />
      </div>
    );
  } else if (!celular) {
    detalhe = (
      <div className="ae-sem-conversa">
        {items.length > 0 && <p>Escolha um atendimento na lista para ler a conversa.</p>}
      </div>
    );
  }

  return (
    <Dialog
      claro
      variant="closed"
      size=""
      labelledBy={tituloId}
      onClose={aoSair}
      dismissible={false}
      // Só leitura: o clique no fundo fecha, como antes (no celular não há fundo).
      closeOnBackdrop={!celular}
      closeOnEsc={!painelNoLugar}
      initialFocus={celular ? 'dialog' : 'auto'}
      className={`ae-dialogo chat-workspace${celular ? ' is-celular' : ''}${naConversa ? ' is-na-conversa' : ''}`}
    >
      <div className="ae-topo" hidden={naConversa}>
        <CabecalhoClaro titulo="Atendimentos encerrados" tituloId={tituloId} extra={contagem} celular={celular} onSair={onClose} />
      </div>
      <div ref={raizRef} className="ae-mestre-detalhe">
        {!naConversa && (
          <div className="ae-coluna-lista">
            <ClosedConversationsList
              conversations={items}
              status={status}
              onSelect={escolher}
              selectedId={selecionadaId}
              hasMore={hasMore}
              loading={loading}
              onLoadMore={loadMore}
              onRetry={refresh}
              erroAoCarregarMais={erroAoCarregarMais}
            />
          </div>
        )}
        {detalhe}
      </div>
    </Dialog>
  );
}

export default ClosedConversationsModal;
