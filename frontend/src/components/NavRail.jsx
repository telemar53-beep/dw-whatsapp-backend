import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { IconChats, IconChart, IconSettings, IconBellOn, IconBellOff, IconUser, IconLogout, IconTeam } from './icons/WaIcons';

const RAIL_BUTTON_BASE =
  'relative flex h-12 w-12 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

// `active` é a página aberta (traço laranja); `highlight` é um estado ligado
// no próprio botão, como o som desativado — laranja, mas sem marca de seção.
function railButtonClass(active, highlight) {
  if (highlight) {
    return `${RAIL_BUTTON_BASE} bg-chat-orange/15 text-chat-orange hover:bg-chat-orange/25`;
  }
  return `${RAIL_BUTTON_BASE} ${
    active ? 'bg-white/[0.16] text-chat-text' : 'text-chat-icon hover:bg-white/[0.08] hover:text-chat-text'
  }`;
}

// O item selecionado ganha um traço laranja rente à borda do menu.
function ActiveMark({ active }) {
  if (!active) return null;
  return <span aria-hidden="true" className="absolute -left-[18px] h-6 w-[3px] rounded-full bg-chat-orange" />;
}

function RailButton({ label, onClick, children, active, highlight }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={railButtonClass(active, highlight)}>
      <ActiveMark active={active} />
      {children}
    </button>
  );
}

function RailLink({ to, label, children, active }) {
  return (
    <Link to={to} aria-label={label} title={label} className={railButtonClass(active)}>
      <ActiveMark active={active} />
      {children}
    </Link>
  );
}

// Persistent left-hand navigation strip, shared across every top-level page (chat,
// metrics, admin, attendance dashboard) so switching between them never leaves the
// attendant stranded with only the browser's own back button - see the "Conversas"
// item, which is the one exception: it needs to reset local state instead of
// navigating when the caller is already on the conversations page.
function NavRail({ active, onConversasClick, onProfileClick, mobileHidden = false }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const agentInitial = agent?.name ? agent.name.trim().charAt(0).toUpperCase() : 'DW';

  return (
    <nav
      aria-label="Navegação principal"
      className={`${
        mobileHidden ? 'hidden md:flex' : 'flex'
      } w-16 shrink-0 flex-col items-center justify-between rounded-[26px] border border-white/[0.07] bg-white/[0.09] py-6 backdrop-blur-2xl md:w-[88px]`}
    >
      <div className="flex flex-col items-center gap-5">
        <span
          aria-hidden="true"
          className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.12] font-display text-[14px] font-semibold tracking-tight text-chat-text"
        >
          DW
        </span>
        {onConversasClick ? (
          <RailButton label="Conversas" active={active === 'conversas'} onClick={onConversasClick}>
            <IconChats size={24} />
          </RailButton>
        ) : (
          <RailLink to="/" label="Conversas" active={active === 'conversas'}>
            <IconChats size={24} />
          </RailLink>
        )}
        <RailLink to="/metrics" label="Relatório" active={active === 'metrics'}>
          <IconChart size={23} />
        </RailLink>
        {agent?.role === 'admin' && (
          <>
            <RailLink to="/admin/dashboard" label="Dashboard de atendimento" active={active === 'dashboard'}>
              <IconTeam size={23} />
            </RailLink>
            <RailLink to="/admin/channels" label="Administração" active={active === 'admin'}>
              <IconSettings size={23} />
            </RailLink>
          </>
        )}
      </div>

      <div className="flex flex-col items-center gap-[9px]">
        <span aria-hidden="true" className="mb-4 h-px w-8 bg-white/15" />
        <RailButton label={muted ? 'Som desativado' : 'Som ativado'} onClick={toggleMuted} highlight={muted}>
          {muted ? <IconBellOff size={22} /> : <IconBellOn size={22} />}
        </RailButton>
        <RailButton label="Meu perfil" onClick={onProfileClick}>
          <IconUser size={22} />
        </RailButton>
        <RailButton label="Sair" onClick={logout}>
          <IconLogout size={22} />
        </RailButton>
        <span
          aria-hidden="true"
          title={agent?.name || 'Atendente'}
          className="mt-2 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/[0.12] font-display text-[15px] font-medium text-chat-text"
        >
          {agentInitial}
        </span>
      </div>
    </nav>
  );
}

export default NavRail;
