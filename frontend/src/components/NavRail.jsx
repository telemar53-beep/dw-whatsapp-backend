import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { IconChats, IconChart, IconSettings, IconBellOn, IconBellOff, IconKey, IconLogout, IconTeam } from './icons/WaIcons';

function RailButton({ label, onClick, children, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green ${
        active ? 'bg-[#e9edef] text-wa-text' : 'text-wa-icon hover:bg-[#e9edef]'
      }`}
    >
      {children}
    </button>
  );
}

function RailLink({ to, label, children, active }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green ${
        active ? 'bg-[#e9edef] text-wa-text' : 'text-wa-icon hover:bg-[#e9edef]'
      }`}
    >
      {children}
    </Link>
  );
}

// Persistent left-hand navigation strip, shared across every top-level page (chat,
// metrics, admin, attendance dashboard) so switching between them never leaves the
// attendant stranded with only the browser's own back button - see the "Conversas"
// item, which is the one exception: it needs to reset local state instead of
// navigating when the caller is already on the conversations page.
function NavRail({ active, onConversasClick, onChangePasswordClick, mobileHidden = false }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const agentInitial = agent?.name ? agent.name.trim().charAt(0).toUpperCase() : 'DW';

  return (
    <nav
      aria-label="Navegação principal"
      className={`${
        mobileHidden ? 'hidden md:flex' : 'flex'
      } w-14 shrink-0 flex-col items-center justify-between border-r border-wa-border bg-wa-panel-header py-3 md:w-[60px]`}
    >
      <div className="flex flex-col items-center gap-1">
        <span
          aria-hidden="true"
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-wa-green text-[13px] font-bold tracking-tight text-white"
        >
          DW
        </span>
        {onConversasClick ? (
          <RailButton label="Conversas" active={active === 'conversas'} onClick={onConversasClick}>
            <IconChats size={23} />
          </RailButton>
        ) : (
          <RailLink to="/" label="Conversas" active={active === 'conversas'}>
            <IconChats size={23} />
          </RailLink>
        )}
        <RailLink to="/metrics" label="Métricas" active={active === 'metrics'}>
          <IconChart size={22} />
        </RailLink>
        {agent?.role === 'admin' && (
          <>
            <RailLink to="/admin/dashboard" label="Dashboard de atendimento" active={active === 'dashboard'}>
              <IconTeam size={22} />
            </RailLink>
            <RailLink to="/admin/channels" label="Administração" active={active === 'admin'}>
              <IconSettings size={22} />
            </RailLink>
          </>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <RailButton label={muted ? 'Som mutado' : 'Som ativado'} onClick={toggleMuted} active={muted}>
          {muted ? <IconBellOff size={21} /> : <IconBellOn size={21} />}
        </RailButton>
        <RailButton label="Trocar senha" onClick={onChangePasswordClick}>
          <IconKey size={21} />
        </RailButton>
        <RailButton label="Sair" onClick={logout}>
          <IconLogout size={21} />
        </RailButton>
        <span
          aria-hidden="true"
          title={agent?.name || 'Atendente'}
          className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[#dfe5e7] text-[13px] font-medium text-[#8696a0]"
        >
          {agentInitial}
        </span>
      </div>
    </nav>
  );
}

export default NavRail;
