import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useNavCollapsed } from '../hooks/useNavCollapsed';
import { NAV_ITEMS, hasLevel } from '../navigation/navItems';
import AgentAvatar from './AgentAvatar';
import { IconBellOn, IconBellOff, IconUser, IconLogout, IconCheckCircle, IconChevronDown, IconWarning } from './icons/WaIcons';
import { primeiroFocavel, prenderTabEm } from './ui/Dialog';
import { useSocketConnection } from '../contexts/SocketContext';

// Sob demanda: importado direto, o popup trazia a ConversationView (e o modal
// de conversa) para dentro da casca, carregada em toda tela.
const ClosedConversationsModal = lazy(() => import('./ClosedConversationsModal'));
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
  const accountPanel = useRef(null);
  const navRef = useRef(null);
  const compact = collapsed && !mobileOpen;
  const items = NAV_ITEMS.filter((item) => hasLevel(agent, item.level));
  useEffect(() => {
    if (!mobileOpen) return undefined;
    // A gaveta é uma <nav> com uma classe, não passa pela pilha de diálogos:
    // sem isto o foco ficava no botão "Abrir menu" e o Tab seguinte ia para o
    // conteúdo ATRÁS da gaveta aberta. Quem devolve o foco ao botão no
    // fechamento é a casca, que é dona dele.
    const alvo = primeiroFocavel(navRef.current);
    if (alvo) alvo.focus();
    function onKey(e) { if (e.key === 'Escape') onMobileClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);
  useEffect(() => {
    if (!accountOpen) return undefined;
    // O painel é renderizado ANTES do gatilho no DOM, e visualmente ele fica
    // ACIMA — a ordem está certa. O que faltava era entregar o foco: ele ficava
    // no gatilho e o Tab seguinte saía da barra lateral inteira, então "Meu
    // perfil" e "Sair" só eram alcançáveis com Shift+Tab.
    const primeiroItem = primeiroFocavel(accountPanel.current);
    if (primeiroItem) primeiroItem.focus();
    function outside(e) { if (!accountRef.current?.contains(e.target)) setAccountOpen(false); }
    function escape(e) { if (e.key === 'Escape') { setAccountOpen(false); accountTrigger.current?.focus(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);
  return <>
    {/* O véu fica UM degrau abaixo da barra, não na mesma camada dela. Enquanto
        os dois disputaram `--z-nav`, quem pintava por cima era o véu (mesmo
        z-index, e o véu vem depois no DOM): no celular a gaveta abria
        escurecida e nenhum toque a alcançava — todo clique caía no véu e
        fechava o menu. */}
    {mobileOpen && <div aria-hidden="true" onClick={onMobileClose} className="fixed inset-0 z-[calc(var(--z-nav)-1)] bg-black/50 md:hidden" />}
    <nav
      id="sidenav"
      ref={navRef}
      aria-label="Navegação principal"
      onKeyDown={mobileOpen ? (evento) => prenderTabEm(navRef.current, evento) : undefined}
      className={`worknav ${compact ? 'is-compact' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
    >
      <MarcaDoMenu compact={compact} companyName={companyName} companyNameStatus={companyNameStatus} />
      <button type="button" className="worknav-collapse" onClick={toggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
        <IconChevronDown size={16} /><span className="worknav-label">Recolher menu</span>
      </button>
      <div className="worknav-destinations">{GROUPS.map(group => {
        const links = items.filter(item => group.keys.includes(item.key));
        const hasClosed = group.label === 'Acompanhamento' && agent?.role === 'agent';
        if (!links.length && !hasClosed) return null;
        return <div className="worknav-group" role="group" key={group.label} aria-label={group.label}>
          {/* aria-hidden: o rótulo continua visível e estilizado, mas para de ser um
              CABEÇALHO — eram três <h2> ("TRABALHO", "ACOMPANHAMENTO",
              "ADMINISTRAÇÃO") antes do <h1> da rota em toda página. Quem nomeia
              o grupo agora é o aria-label. */}
          <h2 aria-hidden="true" className="worknav-label">{group.label}</h2>
          {links.map(item => <NavItem key={item.key} item={item} onNavigate={() => { setAccountOpen(false); onMobileClose(); }} />)}
          {hasClosed && <button type="button" className="worknav-item" title="Atendimentos encerrados" aria-label="Atendimentos encerrados" onClick={() => setClosedOpen(true)}><IconCheckCircle size={19} /><span className="worknav-label">Encerrados</span></button>}
        </div>;
      })}</div>
      <div className="worknav-personal">
        {/* Estado persistente da conexão: fica aqui, no rodapé do menu, para
            não cobrir tabela nem ação nas páginas densas. A faixa da casca é
            só o alerta momentâneo. */}
        {connectionState === 'reconnecting' && (
          // Sem role="status": o anúncio é da região viva da casca (C7-3).
          <div className="worknav-connection" tabIndex={0}>
            <span className="sr-only">Reconectando. As mensagens novas podem demorar a aparecer.</span>
            <IconWarning size={17} />
            <span className="worknav-label">Reconectando…</span>
            <span className="worknav-connection-tip" aria-hidden="true">Reconectando… As mensagens novas podem demorar a aparecer.</span>
          </div>
        )}
        <button type="button" className="worknav-sound" onClick={toggleMuted} title={`Som da fila: ${muted ? 'desativado' : 'ativado'}`} aria-label={`Som da fila — ${muted ? 'Som desativado' : 'Som ativado'}`}>
          {muted ? <IconBellOff size={19} /> : <IconBellOn size={19} />}<span className="worknav-label">Som da fila <small>{muted ? 'Desativado' : 'Ativado'}</small></span>
        </button>
        <div className="worknav-account" ref={accountRef}>
          {/* <ul> em vez de <div>: um `div` sem papel não pode ser nomeado, e o
              `aria-label` que estava aqui era descartado pelo leitor de tela
              (medido: `role: generic, name: "Opções da conta"`). Lista nativa
              resolve sem prometer o contrato de teclado de um `role="menu"`,
              que exigiria setas e não está nesta rodada. */}
          {accountOpen && <ul ref={accountPanel} className="worknav-account-panel" id="worknav-account-actions" aria-label="Opções da conta">
            <li><button type="button" onClick={() => { setAccountOpen(false); onProfileClick(); }}><IconUser size={18} />Meu perfil</button></li>
            <li><button type="button" onClick={() => { setAccountOpen(false); logout(); }}><IconLogout size={18} />Sair</button></li>
          </ul>}
          <button type="button" ref={accountTrigger} className="worknav-account-trigger" title={`Conta: ${agent?.name || 'Atendente'}`} aria-label={`Conta: ${agent?.name || 'Atendente'}`} aria-expanded={accountOpen} aria-controls="worknav-account-actions" onClick={() => setAccountOpen(open => !open)}>
            <AgentAvatar agentId={agent?.id} avatarPath={agent?.avatarPath} name={agent?.name} size={30} />
            <span className="worknav-label"><strong>{agent?.name || 'Atendente'}</strong><small>Minha conta</small></span><span className="worknav-label"><IconChevronDown size={14} /></span>
          </button>
        </div>
      </div>
    </nav>
    {closedOpen && (
      <Suspense fallback={null}>
        <ClosedConversationsModal onClose={() => setClosedOpen(false)} />
      </Suspense>
    )}
  </>;
}
export default SideNav;
