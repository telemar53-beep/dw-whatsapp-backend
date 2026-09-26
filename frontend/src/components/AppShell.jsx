import { useState, useCallback, useEffect, useRef } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { useSocketConnection } from '../contexts/SocketContext';
import SideNav from './SideNav';
import ProfileModal from './ProfileModal';
import { IconChats } from './icons/WaIcons';

// Na mesa, a casca não desenha o menu: reserva um encaixe, e a página da mesa
// (que já vem sob demanda) desenha ali o trilho dela, por portal. Assim o
// trilho, os ícones DW, o botão "Equipe" e o CSS da mesa viajam com a página,
// e a casca — carregada em toda página — não importa nada disso.
// Até a página chegar, o encaixe já tem a largura e o fundo do trilho no
// desktop (no celular o trilho é gaveta e não ocupa espaço): nada pula.
const FUNDO_DO_TRILHO = { background: '#1f1b4b' };
// O ícone do botão "Abrir menu" também vem da página, por portal — e evento de
// portal sobe pela árvore React de quem o desenhou, não pelo botão. Sem isto,
// um toque que caísse no ícone não abria o menu. Assim o toque cai no botão.
const ICONE_SEM_TOQUE = { pointerEvents: 'none' };

// Casca de todas as páginas autenticadas. `dense` = telas com muito conteúdo
// (Configurações, Supervisão, Relatórios): os brilhos do fundo ficam mais fracos.
// `conversationOpen` vem do Atendimento e significa "a conversa OCUPA A TELA
// INTEIRA" — não apenas "existe conversa selecionada". Só nesse caso o botão de
// abrir o menu pode sumir: enquanto a lista ou o rail continuam visíveis, a
// conversa não tomou a tela e esconder o botão apagava a única navegação do
// produto (era o que acontecia de 500 a 767px e no desktop com zoom de 200%).
function AppShell({ dense = false }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const connectionState = useSocketConnection();
  // O Atendimento é a única página com o trilho da mesa, sem os brilhos do
  // fundo e sem o respiro em volta: trilho e lista encostam na borda da tela.
  const naMesa = Boolean(useMatch({ path: '/', end: true }));
  const [encaixeDoTrilho, setEncaixeDoTrilho] = useState(null);
  const [encaixeDoIcone, setEncaixeDoIcone] = useState(null);
  // A faixa e so o alerta momentaneo; quem sustenta o estado e o indicador do
  // menu lateral, que nao cobre tabela nem acao nenhuma.
  const [avisoConexao, setAvisoConexao] = useState(null);
  const estadoAnteriorRef = useRef(connectionState);

  useEffect(() => {
    const anterior = estadoAnteriorRef.current;
    estadoAnteriorRef.current = connectionState;
    if (connectionState === 'reconnecting' && anterior !== 'reconnecting') {
      setAvisoConexao('caiu');
      const t = setTimeout(() => setAvisoConexao(null), 3000);
      return () => clearTimeout(t);
    }
    if (connectionState === 'connected' && anterior === 'reconnecting') {
      setAvisoConexao('voltou');
      const t = setTimeout(() => setAvisoConexao(null), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [connectionState]);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  // A gaveta do menu não é um diálogo, então ninguém guardava quem a abriu: ao
  // fechar com ESC o foco ficava largado no conteúdo. O botão é desta casca,
  // logo é ela que o devolve. `estavaAberta` evita focar o botão na primeira
  // pintura, quando nada foi aberto ainda.
  const gatilhoDoMenu = useRef(null);
  const estavaAberta = useRef(false);
  useEffect(() => {
    if (mobileNavOpen) {
      estavaAberta.current = true;
      return;
    }
    if (!estavaAberta.current) return;
    estavaAberta.current = false;
    const botao = gatilhoDoMenu.current;
    if (botao && document.contains(botao)) botao.focus();
  }, [mobileNavOpen]);
  // Telas densas ficam com 40% do brilho do chat (45%->18%, 25%->10%): o texto
  // sobre painel de vidro precisa de um fundo mais parado que o do Atendimento.
  const glow = dense ? ['bg-chat-copper/[0.06]', 'bg-[#8296a4]/[0.05]'] : ['bg-chat-copper/[0.10]', 'bg-[#8296a4]/[0.07]'];

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      {/* Canto inferior direito: avisar não pode empurrar o layout nem cobrir
          trabalho. O topo era ocupado pelo aviso de canal e o rodapé central
          pelo aviso de transferência (TransferNotice, bottom-5). O compositor
          em repouso tem ~61px e o shell reserva 12px embaixo, então 96px
          deixam ~23px de folga e ainda cobrem uma linha extra digitada.
          `pointer-events-none` garante que nada abaixo deixe de ser clicável
          mesmo se a faixa passar por perto. */}
      {/* Até três role="status" juntos na tela (C7-3): o anúncio vai para uma
          região viva sem papel, sempre montada; o balão visual fica mudo. */}
      <p aria-live="polite" data-aviso-conexao="" className="sr-only">
        {avisoConexao === 'caiu' ? 'Reconectando… as mensagens novas podem demorar a aparecer.' : avisoConexao ? 'Conexão restabelecida.' : ''}
      </p>
      {avisoConexao && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-24 right-5 z-[var(--z-toast)] flex max-w-[min(92vw,26rem)] justify-end"
        >
          {avisoConexao === 'caiu' ? (
            <span className="animate-wa-pop flex items-center gap-2 rounded-full border border-wa-warn-text/40 bg-wa-warn-bg px-3.5 py-1.5 text-left text-[13px] font-medium text-wa-warn-text shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-wa-warn-text animate-wa-rec" />
              Reconectando… as mensagens novas podem demorar a aparecer.
            </span>
          ) : (
            <span className="animate-wa-pop flex items-center gap-2 rounded-full border border-chat-online/40 bg-chat-online/[0.14] px-3.5 py-1.5 text-[13px] font-medium text-chat-online shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-chat-online" />
              Conexão restabelecida.
            </span>
          )}
        </div>
      )}
      {!naMesa && <>
        <div aria-hidden="true" className={`pointer-events-none absolute left-[38%] -top-[10%] h-[38rem] w-[42rem] rounded-full ${glow[0]} blur-[150px]`} />
        <div aria-hidden="true" className={`pointer-events-none absolute -right-[6%] bottom-[-15%] h-[30rem] w-[32rem] rounded-full ${glow[1]} blur-[150px]`} />
      </>}
      <div className={`relative z-10 flex min-h-0 min-w-0 flex-1 ${naMesa ? '' : 'gap-3 p-0 md:p-3'}`}>
        {naMesa
          ? <div ref={setEncaixeDoTrilho} data-encaixe="trilho" className="flex shrink-0 md:w-16" style={FUNDO_DO_TRILHO} />
          : <SideNav onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />}
        {/* `inert` no conteúdo enquanto a gaveta está aberta: é o que impede o
            Tab de sair da gaveta e passear pela página atrás dela — a mesma
            técnica que a pilha de diálogos usa no nível de baixo. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={mobileNavOpen ? '' : undefined}>
          <button
            ref={gatilhoDoMenu}
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menu"
            aria-controls="sidenav"
            aria-expanded={mobileNavOpen}
            data-testid="open-mobile-nav"
            className={`m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.10] text-chat-text transition hover:bg-white/[0.16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${conversationOpen ? 'hidden' : 'md:hidden'}`}
          >
            {/* Na mesa, o ícone vem da página, pelo mesmo caminho do trilho. O
                botão tem tamanho fixo: o ícone chegar depois não mexe em nada. */}
            {naMesa ? <span ref={setEncaixeDoIcone} className="flex" style={ICONE_SEM_TOQUE} /> : <IconChats size={22} />}
          </button>
          <Outlet context={{ openProfile, closeMobileNav, profileVersion, setConversationOpen, mobileNavOpen, encaixeDoTrilho, encaixeDoIcone }} />
        </div>
      </div>
      {profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} onProfileUpdated={() => setProfileVersion((v) => v + 1)} />
      )}
    </div>
  );
}

export default AppShell;
