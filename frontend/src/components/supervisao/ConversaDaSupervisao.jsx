import { createContext, Fragment, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import ContactAvatar from '../ContactAvatar';
import {
  IconeTransferir, IconeEncerrar, IconeConsultarSgp, IconeMaisOpcoes, IconeHistorico, IconeDadosCliente, IconeRecolher, IconeAssumir,
  IconeAnexar, IconeRespostasRapidas, IconeEmoji, IconeMicrofone, IconeEnviar, IconeInformacoes,
} from '../icones';

// O que é SÓ da Supervisão no popup de conversa (2ª fatia). A conversa em si
// — mensagens, compositor, painéis, assumir, transferir, encerrar, janela de
// 24 h — continua toda na ConversationView, a mesma da mesa. Aqui só se
// desenha: o cabeçalho do popup, o menu de opções e a faixa de quem só
// acompanha.

// O cabeçalho é desenhado pela ConversationView (é ela que tem os dados e as
// ações), mas mora no topo do popup, acima da conversa E do painel ao lado:
// ele entra por portal no encaixe que o popup reserva.
export const EncaixeDoCabecalho = createContext(null);

// O mesmo corte de celular da visão geral (supervisao.css) e do CSS do popup.
const CELULAR = '(max-width: 767px)';

function assinarTela(aviso) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const consulta = window.matchMedia(CELULAR);
  consulta.addEventListener('change', aviso);
  return () => consulta.removeEventListener('change', aviso);
}

function telaDeCelular() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CELULAR).matches;
}

// Um controle de saída só, decidido aqui e não pelo CSS: no celular, a seta
// de voltar; no desktop, "Fechar". Os dois nunca existem ao mesmo tempo. O
// popup usa o mesmo critério para os painéis ocuparem o lugar da conversa.
export function useCelular() {
  return useSyncExternalStore(assinarTela, telaDeCelular, () => false);
}

const PARA_A_ESQUERDA = { transform: 'rotate(90deg)' };

// Menu de opções (botão + role="menu"): setas, Home/End, Escape e Tab. O
// Escape fecha só o menu — o popup continua. Escolher um item devolve o foco
// ao botão antes da ação, e é para ele que o foco volta quando a ação abre
// um diálogo (Encerrar, Transferir) e esse diálogo fecha.
function MenuDeOpcoes({ itens, gatilhoRef }) {
  const [aberto, setAberto] = useState(false);
  const botaoRef = useRef(null);
  const menuRef = useRef(null);
  const idDoMenu = useId();

  // O botão do menu é também o "gatilho" do SGP para a ConversationView: é
  // para ele que o foco volta quando o painel do SGP fecha.
  const ligarBotao = useCallback((no) => {
    botaoRef.current = no;
    if (gatilhoRef) gatilhoRef.current = no;
  }, [gatilhoRef]);

  useEffect(() => {
    if (!aberto) return undefined;
    const primeiro = menuRef.current && menuRef.current.querySelector('[role="menuitem"]');
    if (primeiro) primeiro.focus();
    function aoApontarFora(evento) {
      const alvo = evento.target;
      if ((menuRef.current && menuRef.current.contains(alvo)) || (botaoRef.current && botaoRef.current.contains(alvo))) return;
      setAberto(false);
    }
    document.addEventListener('pointerdown', aoApontarFora);
    return () => document.removeEventListener('pointerdown', aoApontarFora);
  }, [aberto]);

  function fechar() {
    setAberto(false);
    if (botaoRef.current) botaoRef.current.focus();
  }

  // O Tab não é tratado aqui: o foco segue para o próximo controle, e sair do
  // menu o fecha (aoPerderFoco).
  function aoTeclar(evento) {
    const lista = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const atual = lista.indexOf(document.activeElement);
    const ir = (i) => { evento.preventDefault(); lista[(i + lista.length) % lista.length].focus(); };
    if (evento.key === 'ArrowDown') ir(atual + 1);
    else if (evento.key === 'ArrowUp') ir(atual - 1);
    else if (evento.key === 'Home') ir(0);
    else if (evento.key === 'End') ir(lista.length - 1);
    else if (evento.key === 'Escape') {
      // Marcado como tratado: a pilha de diálogos não fecha o popup por isto.
      evento.preventDefault();
      evento.stopPropagation();
      fechar();
    }
  }

  // Com o foco fora do menu, as setas e o Escape dele não valem mais: o menu
  // não pode ficar aberto sem dono. Voltar ao próprio botão não conta.
  function aoPerderFoco(evento) {
    const para = evento.relatedTarget;
    if (para && ((menuRef.current && menuRef.current.contains(para)) || para === botaoRef.current)) return;
    setAberto(false);
  }

  function escolher(item) {
    fechar();
    item.aoEscolher();
  }

  return (
    <div className="sp-menu-ancora">
      <button
        ref={ligarBotao}
        type="button"
        className="sp-botao is-icone"
        aria-label="Mais opções"
        title="Mais opções"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        onClick={() => setAberto((a) => !a)}
      >
        <IconeMaisOpcoes tamanho={20} />
      </button>
      {aberto && (
        // mousedown sem ação padrão: tocar num item (ou no respiro do menu) não
        // tira o foco dele — no Safari o toque não foca o botão, e o foco iria
        // para o diálogo, fechando o menu antes do clique chegar.
        <div
          ref={menuRef}
          id={idDoMenu}
          role="menu"
          aria-label="Mais opções"
          className="sp-menu"
          onKeyDown={aoTeclar}
          onBlur={aoPerderFoco}
          onMouseDown={(evento) => evento.preventDefault()}
        >
          {itens.map((item) => (
            <Fragment key={item.chave}>
              {item.perigo && <div role="separator" className="sp-menu-divisor" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={item.perigo ? 'sp-menu-item is-perigo' : 'sp-menu-item'}
                onClick={() => escolher(item)}
              >
                <item.Icone tamanho={18} />
                <span>{item.rotulo}</span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// O cabeçalho único do popup: quem é o cliente, em que estado está a
// conversa e de onde ela veio — e as ações. Nada consultado aqui: só o que a
// conversa já traz. Some quando um painel ocupa o lugar da conversa (celular):
// aí o único controle é o voltar do painel.
function CabecalhoDaSupervisao({
  conversation, displayName, nameLabel, status, canal, podeAgir,
  onVoltar, onTransferir, onEncerrar, onHistorico, sgp, cliente, painelNoLugar, dadosAoLado,
}) {
  const encaixe = useContext(EncaixeDoCabecalho);
  const celular = useCelular();

  // Na ordem do pedido: canal, setor, protocolo e responsável. Quando falta
  // largura, saem inteiros do fim para o começo (CSS). O canal dispensa rótulo;
  // no celular vai só o nome dele, que cabe inteiro ao lado do estado (o
  // "WhatsApp ·" é o mesmo em toda conversa).
  const dados = [
    ['Canal', celular ? conversation.channelName || canal : canal, true],
    ['Setor', conversation.sectorName],
    ['Protocolo', conversation.protocolNumber],
    ['Responsável', conversation.assignedAgentName],
  ].filter(([, valor]) => Boolean(valor));

  // Destrutivo por último, separado e em vermelho. No desktop o Transferir
  // fica à vista; no celular entra no menu.
  const itens = [];
  if (celular && podeAgir) itens.push({ chave: 'transferir', rotulo: 'Transferir', Icone: IconeTransferir, aoEscolher: onTransferir });
  itens.push({ chave: 'sgp', rotulo: sgp.aberto ? 'Fechar consulta SGP' : 'Consultar SGP', Icone: IconeConsultarSgp, aoEscolher: sgp.alternar });
  if (podeAgir) itens.push({ chave: 'encerrar', rotulo: 'Encerrar atendimento', Icone: IconeEncerrar, aoEscolher: onEncerrar, perigo: true });

  const cabecalho = (
    <div className={celular ? 'sp-cab is-celular' : 'sp-cab'} hidden={painelNoLugar}>
      <div className="sp-cab-linha">
        {celular && (
          <button type="button" className="sp-cab-voltar" onClick={onVoltar} aria-label="Voltar para a lista" title="Voltar para a lista">
            <IconeRecolher tamanho={22} style={PARA_A_ESQUERDA} />
          </button>
        )}
        <div className="sp-cab-id">
          {/* A foto repete o nome: fica fora da leitura. */}
          <span className="sp-cab-avatar" aria-hidden="true">
            <ContactAvatar
              contactId={conversation.contactId}
              avatarPath={conversation.contactAvatarPath}
              displayName={displayName}
              phoneNumber={conversation.contactPhoneNumber}
              size={celular ? 36 : 40}
            />
          </span>
          <h2 className="sp-cab-nome" title={nameLabel}>{nameLabel}</h2>
          <span className="sp-cab-estado" data-estado={status.tipo}>{status.label}</span>
          {dados.length > 0 && (
            <dl className="sp-cab-dados">
              {dados.map(([rotulo, valor, semRotulo]) => (
                <div key={rotulo} className="sp-cab-dado">
                  <dt className={semRotulo ? 'sr-only' : undefined}>{rotulo}</dt>
                  <dd title={valor}>{valor}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="sp-cab-acoes">
          {podeAgir && !celular && (
            <button type="button" className="sp-botao" onClick={onTransferir} aria-label="Transferir atendimento">
              <IconeTransferir tamanho={18} />
              <span>Transferir</span>
            </button>
          )}
          {/* Por conversa: a ConversationView não remonta ao trocar de
              conversa, e o menu aberto da anterior não pode sobrar. */}
          <MenuDeOpcoes key={conversation.id} itens={itens} gatilhoRef={sgp.ref} />
          {!celular && (
            <button type="button" className="sp-botao is-fechar" onClick={onVoltar} aria-label="Fechar conversa">
              Fechar
            </button>
          )}
        </div>
      </div>
      {/* Sem lugar para os dados ao lado (celular, janela estreita): as duas
          consultas do cliente ficam à vista, como no mockup. Com lugar, os
          dados já estão ao lado e o Histórico mora neles. */}
      {!dadosAoLado && (
        <div className="sp-cab-atalhos">
          <button
            ref={cliente.ref}
            type="button"
            className="sp-atalho"
            onClick={cliente.alternar}
            aria-expanded={cliente.aberto}
            aria-controls={cliente.aberto ? 'conv-painel-cliente' : undefined}
          >
            <IconeDadosCliente tamanho={18} />
            <span>Dados do cliente</span>
          </button>
          <button type="button" className="sp-atalho" onClick={onHistorico}>
            <IconeHistorico tamanho={18} />
            <span>Histórico</span>
          </button>
        </div>
      )}
      {/* No desktop o SGP abre ao lado e o foco fica no menu: o aviso diz ao
          leitor de tela que algo apareceu. No celular o painel toma a tela e
          o foco vai para ele — não precisa de aviso. */}
      <p role="status" className="sr-only">{sgp.aberto && !celular ? 'Consulta SGP aberta ao lado da conversa.' : ''}</p>
    </div>
  );

  return encaixe ? createPortal(cabecalho, encaixe) : cabecalho;
}

// No lugar do compositor, para quem não responde. Diz por que não há caixa de
// mensagem — sem botão desabilitado nem permissão inventada. O "Assumir" só
// aparece quando a regra de verdade permite (conversa sem responsável): é o
// mesmo assumir da conversa.
function RodapeDaSupervisao({ conversation, podeAssumir, onAssumir }) {
  if (conversation.status === 'closed') {
    return (
      <div className="sp-faixa">
        <p className="sp-faixa-texto">Atendimento encerrado.</p>
      </div>
    );
  }
  if (conversation.assignedAgentId) {
    return (
      <div className="sp-faixa">
        <p className="sp-faixa-texto">
          Acompanhando atendimento de <strong>{conversation.assignedAgentName || 'outro atendente'}</strong>.
        </p>
      </div>
    );
  }
  if (!podeAssumir) return null;
  return (
    <div className="sp-faixa">
      <p className="sp-faixa-texto">Ninguém assumiu este atendimento ainda.</p>
      <BotaoAssumir onAssumir={onAssumir} />
    </div>
  );
}

// Assumir dá certo e a conversa passa a ser de quem assumiu: a faixa sai e o
// compositor entra no lugar. O botão focado sairia junto, e o foco cairia no
// <body> — fora do popup, com o próximo Tab indo para a página de trás. Se
// ele tinha o foco ao sair, o foco vai para o próprio popup. (O efeito de
// layout roda antes de o botão sair do DOM; o foco, depois do commit, e só se
// o popup continua na tela — fechar o popup devolve o foco pela pilha.)
function BotaoAssumir({ onAssumir }) {
  const botaoRef = useRef(null);
  useLayoutEffect(() => () => {
    const botao = botaoRef.current;
    if (!botao || document.activeElement !== botao) return;
    const dialogo = botao.closest('[role="dialog"]');
    if (!dialogo) return;
    queueMicrotask(() => {
      if (dialogo.isConnected && !dialogo.contains(document.activeElement)) dialogo.focus();
    });
  }, []);
  return (
    <button ref={botaoRef} type="button" className="sp-faixa-assumir" onClick={onAssumir}>
      <IconeAssumir tamanho={18} />
      <span>Assumir atendimento</span>
    </button>
  );
}

// Os ícones que a ConversationView e o MessageInput desenham por dentro, no
// formato que eles já usam (um componente que recebe `size`): os mesmos da
// mesa (ConversaDaMesa.jsx). Montados aqui, e não importados de lá: importar o
// módulo da mesa o tiraria do trecho dela (2 arquivos a mais na rota /).
const tamanhoDW = (Icone) => function IconeDoCompositor({ size }) {
  return <Icone tamanho={size} />;
};

// Um objeto só, definido uma vez: o popup o passa sempre igual.
export const VARIANTE_DA_SUPERVISAO = Object.freeze({
  Cabecalho: CabecalhoDaSupervisao,
  Rodape: RodapeDaSupervisao,
  icones: Object.freeze({
    Anexar: tamanhoDW(IconeAnexar),
    Respostas: tamanhoDW(IconeRespostasRapidas),
    Emoji: tamanhoDW(IconeEmoji),
    Microfone: tamanhoDW(IconeMicrofone),
    Enviar: tamanhoDW(IconeEnviar),
    Info: tamanhoDW(IconeInformacoes),
    Responder: tamanhoDW(IconeRecolher),
  }),
});
