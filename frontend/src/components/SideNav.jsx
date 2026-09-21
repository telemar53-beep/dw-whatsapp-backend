import { useState, useEffect, useRef } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useNavCollapsed } from '../hooks/useNavCollapsed';
import { NAV_ITEMS, hasLevel } from '../navigation/navItems';
import ClosedConversationsModal from './ClosedConversationsModal';
import AgentAvatar from './AgentAvatar';
import { IconBellOn, IconBellOff, IconUser, IconLogout, IconCheckCircle, IconChevronDown, IconWarning } from './icons/WaIcons';
import { useSocketConnection } from '../contexts/SocketContext';
import './side-nav.css';
import { marcaDaInstalacao } from '../branding';

export function iniciaisDaEmpresa(nome) {
  const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '';
  const primeira = palavras[0];
  if (primeira.length <= 2 && primeira === primeira.toUpperCase()) return primeira;
  return palavras.slice(0, 2).map((palavra) => palavra[0].toUpperCase()).join('');
}

// A marca do menu vem de `branding` — a identidade DESTA instalação — e nunca
// de um import fixo aqui. Sem marca configurada, o monograma com as iniciais
// de `companyName` assume: nenhum provedor vê a marca de outro.
//
// O texto alternativo e o tooltip usam sempre o nome da empresa, não uma marca
// escrita no código.
function MarcaDoMenu({ compact, companyName, companyNameStatus }) {
  const nome = companyName || 'Atendimento';
  const arte = compact ? marcaDaInstalacao.compacta : marcaDaInstalacao.horizontal;

  if (arte) {
    return (
      <div className="worknav-brand" title={nome}>
        {compact
          ? <img className="worknav-logo" src={arte} alt={nome} width={40} height={40} />
          : <img className="worknav-full-logo" src={arte} alt={nome} />}
      </div>
    );
  }

  // Enquanto o nome não chega, o monograma fica vazio de propósito: o espaço
  // já está reservado e a barra não pula quando a resposta chega.
  const iniciais = companyNameStatus === 'loading' ? '' : iniciaisDaEmpresa(companyName);
  return (
    <div className="worknav-brand is-sem-marca" title={nome}>
      <span className="worknav-monogram" aria-hidden="true">{iniciais}</span>
      {!compact && <span className="worknav-label"><strong>{companyName || ''}</strong></span>}
    </div>
  );
}

const GROUPS = [
  { label: 'Trabalho', keys: ['atendimento', 'supervisao', 'campanhas'] },
  { label: 'Acompanhamento', keys: ['relatorios'] },
  { label: 'Administração', keys: ['configuracoes'] },
];
function NavItem({ item, onNavigate }) {
  const active = Boolean(useMatch({ path: item.match, end: item.match === '/' }));
  const Icon = item.icon;
  return <NavLink to={item.to} end={item.match === '/'} title={item.label} aria-label={item.label}
    aria-current={active ? 'page' : undefined} onClick={onNavigate} className="worknav-item">
    <Icon size={19} /><span className="worknav-label">{item.label}</span>
  </NavLink>;
}
function SideNav({ onProfileClick, mobileOpen = false, onMobileClose = () => {} }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const { name: companyName, status: companyNameStatus } = useCompanyName();
  const inChat = Boolean(useMatch({ path: '/', end: true }));
  const { collapsed, toggle } = useNavCollapsed({ context: inChat ? 'chat' : 'administration', defaultCollapsed: inChat });
  const connectionState = useSocketConnection();
  const [closedOpen, setClosedOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const accountTrigger = useRef(null);
  const compact = collapsed && !mobileOpen;
  const items = NAV_ITEMS.filter((item) => hasLevel(agent, item.level));
  useEffect(() => {
    if (!mobileOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') onMobileClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);
  useEffect(() => {
    if (!accountOpen) return undefined;
    function outside(e) { if (!accountRef.current?.contains(e.target)) setAccountOpen(false); }
    function escape(e) { if (e.key === 'Escape') { setAccountOpen(false); accountTrigger.current?.focus(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);
  return <>
    {mobileOpen && <div aria-hidden="true" onClick={onMobileClose} className="fixed inset-0 z-[var(--z-nav)] bg-black/50 md:hidden" />}
    <nav id="sidenav" aria-label="Navegação principal" className={`worknav ${compact ? 'is-compact' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <MarcaDoMenu compact={compact} companyName={companyName} companyNameStatus={companyNameStatus} />
      <button type="button" className="worknav-collapse" onClick={toggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
        <IconChevronDown size={16} /><span className="worknav-label">Recolher menu</span>
      </button>
      <div className="worknav-destinations">{GROUPS.map(group => {
        const links = items.filter(item => group.keys.includes(item.key));
        const hasClosed = group.label === 'Acompanhamento' && agent?.role === 'agent';
        if (!links.length && !hasClosed) return null;
        return <section className="worknav-group" key={group.label} aria-label={group.label}>
          <h2 className="worknav-label">{group.label}</h2>
          {links.map(item => <NavItem key={item.key} item={item} onNavigate={() => { setAccountOpen(false); onMobileClose(); }} />)}
          {hasClosed && <button type="button" className="worknav-item" title="Atendimentos encerrados" aria-label="Atendimentos encerrados" onClick={() => setClosedOpen(true)}><IconCheckCircle size={19} /><span className="worknav-label">Encerrados</span></button>}
        </section>;
      })}</div>
      <div className="worknav-personal">
        {/* Estado persistente da conexão: fica aqui, no rodapé do menu, para
            não cobrir tabela nem ação nas páginas densas. A faixa da casca é
            só o alerta momentâneo. */}
        {connectionState === 'reconnecting' && (
          <div className="worknav-connection" role="status" tabIndex={0} aria-label="Reconectando. As mensagens novas podem demorar a aparecer.">
            <IconWarning size={17} />
            <span className="worknav-label">Reconectando…</span>
            <span className="worknav-connection-tip" aria-hidden="true">Reconectando… As mensagens novas podem demorar a aparecer.</span>
          </div>
        )}
        <button type="button" className="worknav-sound" onClick={toggleMuted} title={`Som da fila: ${muted ? 'desativado' : 'ativado'}`} aria-label={`Som da fila — ${muted ? 'Som desativado' : 'Som ativado'}`}>
          {muted ? <IconBellOff size={19} /> : <IconBellOn size={19} />}<span className="worknav-label">Som da fila <small>{muted ? 'Desativado' : 'Ativado'}</small></span>
        </button>
        <div className="worknav-account" ref={accountRef}>
          {accountOpen && <div className="worknav-account-panel" id="worknav-account-actions" aria-label="Opções da conta">
            <button type="button" onClick={() => { setAccountOpen(false); onProfileClick(); }}><IconUser size={18} />Meu perfil</button>
            <button type="button" onClick={() => { setAccountOpen(false); logout(); }}><IconLogout size={18} />Sair</button>
          </div>}
          <button type="button" ref={accountTrigger} className="worknav-account-trigger" title={`Conta: ${agent?.name || 'Atendente'}`} aria-label={`Conta: ${agent?.name || 'Atendente'}`} aria-expanded={accountOpen} aria-controls="worknav-account-actions" onClick={() => setAccountOpen(open => !open)}>
            <AgentAvatar agentId={agent?.id} avatarPath={agent?.avatarPath} name={agent?.name} size={30} />
            <span className="worknav-label"><strong>{agent?.name || 'Atendente'}</strong><small>Minha conta</small></span><span className="worknav-label"><IconChevronDown size={14} /></span>
          </button>
        </div>
      </div>
    </nav>
    {closedOpen && <ClosedConversationsModal onClose={() => setClosedOpen(false)} />}
  </>;
}
export default SideNav;
