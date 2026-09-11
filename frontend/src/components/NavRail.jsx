import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { IconChats, IconChart, IconSettings, IconBellOn, IconBellOff, IconUser, IconLogout, IconTeam } from './icons/WaIcons';

const RAIL_BUTTON_BASE =
  'flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

function railButtonClass(active, dark) {
  if (dark) {
    return `${RAIL_BUTTON_BASE} focus-visible:outline-white/70 ${
      active ? 'bg-white/12 text-chat-text shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)]' : 'text-chat-icon hover:bg-white/8 hover:text-chat-text'
    }`;
  }
  return `${RAIL_BUTTON_BASE} focus-visible:outline-teal-signal ${
    active ? 'bg-teal-signal text-white shadow-[0_6px_16px_-6px_rgba(13,148,136,0.55)]' : 'text-ink-950/45 hover:bg-white/60 hover:text-ink-950'
  }`;
}

function RailButton({ label, onClick, children, active, dark }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={railButtonClass(active, dark)}>
      {children}
    </button>
  );
}

function RailLink({ to, label, children, active, dark }) {
  return (
    <Link to={to} aria-label={label} title={label} className={railButtonClass(active, dark)}>
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
          ? 'w-16 shrink-0 flex-col items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-chat-rail/90 py-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.7)] md:w-[72px]'
          : 'w-14 shrink-0 flex-col items-center justify-between border-r border-white/50 bg-gradient-to-b from-sky-mist/70 via-teal-mist/50 to-sand-mist/60 py-4 backdrop-blur-xl md:w-[64px]'
      }`}
    >
      <div className="flex flex-col items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl font-display text-[13px] font-semibold tracking-tight shadow-sm ${
            dark ? 'bg-white/10 text-chat-text' : 'bg-teal-signal text-white'
          }`}
        >
          DW
        </span>
        {onConversasClick ? (
          <RailButton label="Conversas" active={active === 'conversas'} onClick={onConversasClick} dark={dark}>
            <IconChats size={23} />
          </RailButton>
        ) : (
          <RailLink to="/" label="Conversas" active={active === 'conversas'} dark={dark}>
            <IconChats size={23} />
          </RailLink>
        )}
        <RailLink to="/metrics" label="Relatório" active={active === 'metrics'} dark={dark}>
          <IconChart size={22} />
        </RailLink>
        {agent?.role === 'admin' && (
          <>
            <RailLink to="/admin/dashboard" label="Dashboard de atendimento" active={active === 'dashboard'} dark={dark}>
              <IconTeam size={22} />
            </RailLink>
            <RailLink to="/admin/channels" label="Administração" active={active === 'admin'} dark={dark}>
              <IconSettings size={22} />
            </RailLink>
          </>
        )}
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <RailButton label={muted ? 'Som mutado' : 'Som ativado'} onClick={toggleMuted} active={muted} dark={dark}>
          {muted ? <IconBellOff size={21} /> : <IconBellOn size={21} />}
        </RailButton>
        <RailButton label="Meu perfil" onClick={onProfileClick} dark={dark}>
          <IconUser size={21} />
        </RailButton>
        <RailButton label="Sair" onClick={logout} dark={dark}>
          <IconLogout size={21} />
        </RailButton>
        <span
          aria-hidden="true"
          title={agent?.name || 'Atendente'}
          className={`mt-1 flex h-9 w-9 items-center justify-center rounded-full border font-display text-[13px] font-medium ${
            dark ? 'border-white/15 bg-white/10 text-chat-text' : 'border-white/60 bg-white/50 text-ink-950/70'
          }`}
        >
          {agentInitial}
        </span>
      </div>
    </nav>
  );
}

export default NavRail;
