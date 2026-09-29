import { useState, useCallback, useEffect, useRef } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasLevel } from '../navigation/navItems';
import { sobDemanda, useSobDemanda } from '../utils/sobDemanda';
import { useAlert } from '../hooks/useAlert';
import SideNav from './SideNav';
import AvisoDeConexao from './AvisoDeConexao';
import { IconChats } from './icons/WaIcons';

// "Meu perfil" chega quando é aberto: a casca, que toda página autenticada
// baixa, não leva o formulário nem a folha dele (guardas/bloco1SobDemanda).
// Se o trecho não baixar, a casca avisa e o próximo clique tenta de novo.
const PERFIL = sobDemanda(() => import('./ProfileModal'));

// Na mesa, na Supervisão e em Configurações, a casca não desenha o menu: reserva um encaixe, e a
// página (que já vem sob demanda) desenha ali o trilho, por portal. Assim o
// trilho, os ícones DW, o botão "Equipe" e o CSS do trilho viajam com essas
// páginas, e a casca — carregada em toda página — não importa nada disso.
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
  // O Atendimento, a Supervisão e Configurações têm o trilho da mesa, sem os brilhos do fundo
  // e sem o respiro em volta: trilho e página encostam na borda da tela.
  const naMesa = Boolean(useMatch({ path: '/', end: true }));
  // Na Supervisão, só para quem tem o nível da rota: para os outros ela vira
  // a página de acesso negado, que não desenha trilho — e o menu sumiria.
  const { agent } = useAuth();
  const naSupervisao = Boolean(useMatch({ path: '/supervisao', end: true })) && hasLevel(agent, 'admin');
  // Configurações (Fatia S1, 29/09): como na Supervisão, só para quem tem o
  // nível da rota — para o atendente ela é a página de acesso negado, que não
  // desenha trilho, e ele fica com o menu de sempre.
  const emConfiguracoes = Boolean(useMatch({ path: '/configuracoes/*' })) && hasLevel(agent, 'admin');
  const comTrilho = naMesa || naSupervisao || emConfiguracoes;
  const [encaixeDoTrilho, setEncaixeDoTrilho] = useState(null);
  const [encaixeDoIcone, setEncaixeDoIcone] = useState(null);
  const { avisar, alertDialog } = useAlert();
  const perfilNaoBaixou = useCallback(() => {
    setProfileOpen(false);
    avisar('Não foi possível abrir o Meu perfil. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const Perfil = useSobDemanda(PERFIL, profileOpen, perfilNaoBaixou);
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
      {/* Um aviso de conexão só, para o estado inteiro (C7). */}
      <AvisoDeConexao />
      {!comTrilho && <>
        <div aria-hidden="true" className={`pointer-events-none absolute left-[38%] -top-[10%] h-[38rem] w-[42rem] rounded-full ${glow[0]} blur-[150px]`} />
        <div aria-hidden="true" className={`pointer-events-none absolute -right-[6%] bottom-[-15%] h-[30rem] w-[32rem] rounded-full ${glow[1]} blur-[150px]`} />
      </>}
      <div className={`relative z-10 flex min-h-0 min-w-0 flex-1 ${comTrilho ? '' : 'gap-3 p-0 md:p-3'}`}>
        {comTrilho
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
            {/* Com o trilho, o ícone vem da página, pelo mesmo caminho dele. O
                botão tem tamanho fixo: o ícone chegar depois não mexe em nada. */}
            {comTrilho ? <span ref={setEncaixeDoIcone} className="flex" style={ICONE_SEM_TOQUE} /> : <IconChats size={22} />}
          </button>
          <Outlet context={{ openProfile, closeMobileNav, profileVersion, setConversationOpen, mobileNavOpen, encaixeDoTrilho, encaixeDoIcone }} />
        </div>
      </div>
      {profileOpen && (Perfil
        ? <Perfil onClose={() => setProfileOpen(false)} onProfileUpdated={() => setProfileVersion((v) => v + 1)} />
        : <p role="status" className="sr-only">Abrindo o Meu perfil…</p>)}
      {alertDialog}
    </div>
  );
}

export default AppShell;
