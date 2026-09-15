import { useState, useEffect } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useNavCollapsed } from '../hooks/useNavCollapsed';
import { NAV_ITEMS, hasLevel } from '../navigation/navItems';
import ClosedConversationsModal from './ClosedConversationsModal';
import AgentAvatar from './AgentAvatar';
import { IconBellOn, IconBellOff, IconUser, IconLogout, IconCheckCircle, IconChats, IconChevronDown } from './icons/WaIcons';

// Copiada de NavRail.jsx, que se aposentou na Task 17.
export function iniciaisDaEmpresa(nome) {
  const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '';
  const primeira = palavras[0];
  if (primeira.length <= 2 && primeira === primeira.toUpperCase()) return primeira;
  return palavras.slice(0, 2).map((palavra) => palavra[0].toUpperCase()).join('');
}

const ITEM_BASE =
  'relative flex h-11 items-center gap-3 rounded-[14px] px-3 text-[14px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

function NavItem({ item, collapsed, onNavigate }) {
  const active = Boolean(useMatch({ path: item.match, end: item.match === '/' }));
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.match === '/'}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`${ITEM_BASE} ${active ? 'bg-white/[0.14] text-chat-text' : 'text-chat-icon hover:bg-white/[0.08] hover:text-chat-text'} ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {active && <span aria-hidden="true" className="absolute -left-3 h-6 w-[3px] rounded-full bg-chat-orange" />}
      <Icon size={22} />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
    </NavLink>
  );
}

function FooterButton({ label, onClick, highlight, collapsed, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${ITEM_BASE} w-full ${highlight ? 'bg-chat-orange/15 text-chat-orange hover:bg-chat-orange/25' : 'text-chat-icon hover:bg-white/[0.08] hover:text-chat-text'} ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {children}
      <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
    </button>
  );
}

function SideNav({ onProfileClick, mobileOpen = false, onMobileClose = () => {} }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const { name: companyName } = useCompanyName();
  const { collapsed, toggle } = useNavCollapsed();
  const [closedOpen, setClosedOpen] = useState(false);
  const iniciais = iniciaisDaEmpresa(companyName);
  const items = NAV_ITEMS.filter((item) => hasLevel(agent, item.level));
  const compact = collapsed && !mobileOpen;

  useEffect(() => {
    if (!mobileOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') onMobileClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {mobileOpen && <div aria-hidden="true" onClick={onMobileClose} className="fixed inset-0 z-30 bg-black/50 md:hidden" />}
      <nav
        id="sidenav"
        aria-label="Navegação principal"
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex w-[264px]' : 'hidden md:flex'} ${collapsed ? 'md:w-[72px]' : 'md:w-[232px]'} shrink-0 flex-col justify-between rounded-r-[26px] border border-white/[0.07] bg-chat-rail/95 px-3 py-5 backdrop-blur-2xl md:relative md:rounded-[26px] md:bg-white/[0.09]`}
      >
        <div className="flex flex-col gap-1.5">
          <div className={`mb-4 flex items-center gap-3 ${compact ? 'justify-center' : 'px-1'}`}>
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.12] font-display text-[14px] font-semibold text-chat-text">
              {iniciais || <IconChats size={22} />}
            </span>
            {!compact && <span className="truncate font-display text-[15px] font-semibold text-chat-text">{companyName}</span>}
          </div>
          {items.map((item) => (
            <NavItem key={item.key} item={item} collapsed={compact} onNavigate={onMobileClose} />
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`${ITEM_BASE} mb-2 hidden text-chat-faint hover:text-chat-text md:flex ${compact ? 'justify-center px-0' : ''}`}
          >
            <span className={`transition ${collapsed ? '-rotate-90' : 'rotate-90'}`}><IconChevronDown size={18} /></span>
            <span className={compact ? 'sr-only' : ''}>{collapsed ? 'Expandir' : 'Recolher'}</span>
          </button>
          <FooterButton label={muted ? 'Som desativado' : 'Som ativado'} onClick={toggleMuted} highlight={muted} collapsed={compact}>
            {muted ? <IconBellOff size={20} /> : <IconBellOn size={20} />}
          </FooterButton>
          {agent?.role === 'agent' && (
            <FooterButton label="Atendimentos encerrados" onClick={() => setClosedOpen(true)} collapsed={compact}>
              <IconCheckCircle size={20} />
            </FooterButton>
          )}
          <FooterButton label="Meu perfil" onClick={onProfileClick} collapsed={compact}>
            <IconUser size={20} />
          </FooterButton>
          <FooterButton label="Sair" onClick={logout} collapsed={compact}>
            <IconLogout size={20} />
          </FooterButton>
          <div className={`mt-2 flex items-center gap-3 ${compact ? 'justify-center' : 'px-1'}`} title={agent?.name || 'Atendente'}>
            <span className="overflow-hidden rounded-[12px] border border-white/20">
              <AgentAvatar agentId={agent?.id} avatarPath={agent?.avatarPath} name={agent?.name} size={40} shape="square" />
            </span>
            {!compact && <span className="truncate text-[13px] text-chat-muted">{agent?.name}</span>}
          </div>
        </div>
      </nav>
      {closedOpen && <ClosedConversationsModal onClose={() => setClosedOpen(false)} />}
    </>
  );
}

export default SideNav;
