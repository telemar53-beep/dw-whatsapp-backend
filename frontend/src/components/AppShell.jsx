import { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import SideNav from './SideNav';
import ProfileModal from './ProfileModal';
import { IconChats } from './icons/WaIcons';

// Casca de todas as páginas autenticadas. `dense` = telas com muito conteúdo
// (Configurações, Supervisão, Relatórios): os brilhos do fundo ficam mais fracos.
// `conversationOpen` vem do Atendimento: com uma conversa aberta no celular, o
// botão de abrir o menu some (o chat ocupa a tela inteira, como hoje).
function AppShell({ dense = false }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const glow = dense ? ['bg-chat-copper/15', 'bg-chat-copper/10'] : ['bg-chat-copper/45', 'bg-chat-copper/25'];

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div aria-hidden="true" className={`pointer-events-none absolute left-[38%] -top-[10%] h-[38rem] w-[42rem] rounded-full ${glow[0]} blur-[150px]`} />
      <div aria-hidden="true" className={`pointer-events-none absolute -right-[6%] bottom-[-15%] h-[30rem] w-[32rem] rounded-full ${glow[1]} blur-[150px]`} />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-0 md:p-3">
        <SideNav onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menu"
            aria-controls="sidenav"
            aria-expanded={mobileNavOpen}
            data-testid="open-mobile-nav"
            className={`m-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.10] text-chat-text ${conversationOpen ? 'hidden' : 'md:hidden'}`}
          >
            <IconChats size={22} />
          </button>
          <Outlet context={{ openProfile, closeMobileNav, profileVersion, setConversationOpen }} />
        </div>
      </div>
      {profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} onProfileUpdated={() => setProfileVersion((v) => v + 1)} />
      )}
    </div>
  );
}

export default AppShell;
