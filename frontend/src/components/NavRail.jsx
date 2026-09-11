import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { IconChats, IconChart, IconSettings, IconBellOn, IconBellOff, IconUser, IconLogout, IconTeam } from './icons/WaIcons';

const RAIL_BUTTON_BASE =
  'flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

function railButtonClass(active, dark) {
  if (dark) {
    return `relative flex h-12 w-12 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
      active ? 'bg-white/[0.16] text-chat-text' : 'text-chat-icon hover:bg-white/[0.08] hover:text-chat-text'
    }`;
  }
  return `${RAIL_BUTTON_BASE} focus-visible:outline-teal-signal ${
    active ? 'bg-teal-signal text-white shadow-[0_6px_16px_-6px_rgba(13,148,136,0.55)]' : 'text-ink-950/45 hover:bg-white/60 hover:text-ink-950'
  }`;
}

// No vidro fumê o item selecionado ganha um traço laranja rente à borda do menu.
function ActiveMark({ active, dark }) {
  if (!active || !dark) return null;
  return <span aria-hidden="true" className="absolute -left-[18px] h-6 w-[3px] rounded-full bg-chat-orange" />;
}

function RailButton({ label, onClick, children, active, dark }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={railButtonClass(active, dark)}>
      <ActiveMark active={active} dark={dark} />
      {children}
    </button>
  );
}

function RailLink({ to, label, children, active, dark }) {
  return (
    <Link to={to} aria-label={label} title={label} className={railButtonClass(active, dark)}>
      <ActiveMark active={active} dark={dark} />
      {children}
    </Link>
  );
}

// Persistent left-hand navigation strip, shared across every top-level page (chat,
// metrics, admin, attendance dashboard) so switching between them never leaves the
// attendant stranded with only the browser's own back button - see the "Conversas"
// item, which is the one exception: it needs to reset local state instead of
// navigating when the caller is already on the conversations page.
function NavRail({ active, onConversasClick, onProfileClick, mobileHidden = false, dark = false }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const agentInitial = agent?.name ? agent.name.trim().charAt(0).toUpperCase() : 'DW';

  return (
    <nav
      aria-label="Navegação principal"
      className={`${mobileHidden ? 'hidden md:flex' : 'flex'} ${
        dark
          ? 'w-16 shrink-0 flex-col items-center justify-between rounded-[26px] border border-white/[0.07] bg-white/[0.09] py-6 backdrop-blur-2xl md:w-[88px]'
          : 'w-14 shrink-0 flex-col items-center justify-between border-r border-white/50 bg-gradient-to-b from-sky-mist/70 via-teal-mist/50 to-sand-mist/60 py-4 backdrop-blur-xl md:w-[64px]'
      }`}
    >
      <div className={`flex flex-col items-center ${dark ? 'gap-5' : 'gap-1.5'}`}>
        <span
          aria-hidden="true"
          className={`mb-2 flex items-center justify-center font-display font-semibold tracking-tight ${
            dark
              ? 'h-12 w-12 rounded-full bg-white/[0.12] text-[14px] text-chat-text'
              : 'h-9 w-9 rounded-xl bg-teal-signal text-[13px] text-white shadow-sm'
          }`}
        >
          DW
        </span>
        {onConversasClick ? (
          <RailButton label="Conversas" active={active === 'conversas'} onClick={onConversasClick} dark={dark}>
            <IconChats size={dark ? 24 : 23} />
          </RailButton>
        ) : (
          <RailLink to="/" label="Conversas" active={active === 'conversas'} dark={dark}>
            <IconChats size={dark ? 24 : 23} />
          </RailLink>
        )}
        <RailLink to="/metrics" label="Relatório" active={active === 'metrics'} dark={dark}>
          <IconChart size={dark ? 23 : 22} />
        </RailLink>
        {agent?.role === 'admin' && (
          <>
            <RailLink to="/admin/dashboard" label="Dashboard de atendimento" active={active === 'dashboard'} dark={dark}>
              <IconTeam size={dark ? 23 : 22} />
            </RailLink>
            <RailLink to="/admin/channels" label="Administração" active={active === 'admin'} dark={dark}>
              <IconSettings size={dark ? 23 : 22} />
            </RailLink>
          </>
        )}
      </div>

      <div className={`flex flex-col items-center ${dark ? 'gap-[9px]' : 'gap-1.5'}`}>
        {dark && <span aria-hidden="true" className="mb-4 h-px w-8 bg-white/15" />}
        <RailButton label={muted ? 'Som mutado' : 'Som ativado'} onClick={toggleMuted} active={muted} dark={dark}>
          {muted ? <IconBellOff size={dark ? 22 : 21} /> : <IconBellOn size={dark ? 22 : 21} />}
        </RailButton>
        <RailButton label="Meu perfil" onClick={onProfileClick} dark={dark}>
          <IconUser size={dark ? 22 : 21} />
        </RailButton>
        <RailButton label="Sair" onClick={logout} dark={dark}>
          <IconLogout size={dark ? 22 : 21} />
        </RailButton>
        <span
          aria-hidden="true"
          title={agent?.name || 'Atendente'}
          className={`mt-2 flex items-center justify-center rounded-full border font-display font-medium ${
            dark
              ? 'h-11 w-11 border-white/20 bg-white/[0.12] text-[15px] text-chat-text'
              : 'h-9 w-9 border-white/60 bg-white/50 text-[13px] text-ink-950/70'
          }`}
        >
          {agentInitial}
        </span>
      </div>
    </nav>
  );
}

export default NavRail;
