import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useAlert } from '../hooks/useAlert';
import { sobDemanda, useSobDemanda } from '../utils/sobDemanda';
import { useCompanyName } from '../hooks/useCompanyName';
import { NAV_ITEMS, hasLevel } from '../navigation/navItems';
import { marcaDaInstalacao } from '../branding';
import AgentAvatar from './AgentAvatar';
import TeamPanel from './TeamPanel';
import { primeiroFocavel, prenderTabEm } from './ui/Dialog';
import {
  IconeAtendimento, IconeFilas, IconeCampanhas, IconeRelatorios, IconeConfiguracoes,
  IconeEncerrados, IconeSom, IconeSomDesativado, IconeMenu,
} from './icones';
import './trilho-mesa.css';

// Trilho lateral do Atendimento (a mesa). Quem o desenha é a página da mesa,
// por portal, no encaixe que a casca reserva (ver AppShell.jsx): assim nada
// daqui — nem os ícones DW, nem o botão "Equipe", nem este CSS — viaja para as
// outras páginas, que continuam com o SideNav.
//
// As classes `worknav*` são as do menu (side-nav.css, que a casca já carrega);
// trilho-mesa.css só acrescenta o que é da mesa, sob [data-variante=mesa].

// Os encerrados chegam quando são abertos, pelo mesmo carregador dos outros
// diálogos (utils/sobDemanda.js): se o trecho não baixar, o trilho avisa e a
// mesa continua de pé — com React.lazy a falha subia até a rota.
const ENCERRADOS = sobDemanda(() => import('./ClosedConversationsModal'));

// Os mesmos destinos do menu, com as mesmas rotas e os mesmos níveis de acesso
// (hasLevel) — só o nome e o ícone mudam. "Filas" é a Supervisão; nada de
// rota ou permissão nova. A ordem aqui é a ordem na tela. Canais (Números
// conectados) não tem atalho: fica em Configurações, que então é o ativo.
const doMenu = (key) => NAV_ITEMS.find((item) => item.key === key);
const DESTINOS = [
  { ...doMenu('atendimento'), icone: IconeAtendimento },
  { ...doMenu('supervisao'), label: 'Filas (Supervisão)', icone: IconeFilas },
  { key: 'equipe' },
  { ...doMenu('campanhas'), icone: IconeCampanhas },
  { ...doMenu('relatorios'), icone: IconeRelatorios },
];
const CONFIGURACOES = { ...doMenu('configuracoes'), icone: IconeConfiguracoes };

// Ícone do botão "Abrir menu" da casca, no celular. A página o desenha no
// botão pelo mesmo caminho do trilho, para a casca não carregar ícone DW.
// 20px, como a outra ação do cabeçalho (Nova conversa).
export function IconeDoMenu() {
  return <IconeMenu />;
}

// A marca compacta do menu (MarcaDoMenu, em SideNav.jsx): a arte desta
// instalação, ou o monograma com as iniciais da empresa.
//
// As iniciais são a mesma regra de `iniciaisDaEmpresa` (SideNav.jsx), copiada
// de propósito: importar do SideNav puxaria o menu inteiro para um trecho
// compartilhado com a mesa, e toda página passaria a baixar um arquivo a
// mais. TrilhoDaMesa.test.jsx confere que as duas dão o mesmo resultado.
export function iniciais(nome) {
  const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '';
  const primeira = palavras[0];
  if (primeira.length <= 2 && primeira === primeira.toUpperCase()) return primeira;
  return palavras.slice(0, 2).map((palavra) => palavra[0].toUpperCase()).join('');
}
function Marca({ companyName, status }) {
  const nome = companyName || 'Atendimento';
  if (marcaDaInstalacao.compacta) {
    return <div className="worknav-brand" title={nome}><img className="worknav-logo" src={marcaDaInstalacao.compacta} alt={nome} width={40} height={40} /></div>;
  }
  return (
    <div className="worknav-brand is-sem-marca" title={nome}>
      <span className="worknav-monogram" aria-hidden="true">{status === 'loading' ? '' : iniciais(companyName)}</span>
    </div>
  );
}

// O rótulo não fica à vista: vira a dica, que aparece no ponteiro e no foco de
// teclado (CSS, sem estado). Quem nomeia o destino é o aria-label.
function Destino({ item, onNavigate }) {
  const ativo = Boolean(useMatch({ path: item.match, end: item.match === '/' }));
  const Icone = item.icone;
  return (
    <NavLink to={item.to} end={item.match === '/'} aria-label={item.label} aria-current={ativo ? 'page' : undefined} onClick={onNavigate} className="worknav-item">
      <Icone /><span className="worknav-dica" aria-hidden="true">{item.label}</span>
    </NavLink>
  );
}

function TrilhoDaMesa({ onProfileClick, mobileOpen = false, onMobileClose = () => {}, profileVersion = 0 }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const { name: companyName, status: companyNameStatus } = useCompanyName();
  const [closedOpen, setClosedOpen] = useState(false);
  const { avisar, alertDialog } = useAlert();
  const encerradosNaoBaixaram = useCallback(() => {
    setClosedOpen(false);
    avisar('Não foi possível abrir os atendimentos encerrados. Verifique a conexão e tente de novo.', { tom: 'erro' });
  }, [avisar]);
  const Encerrados = useSobDemanda(ENCERRADOS, closedOpen, encerradosNaoBaixaram);
  const [accountOpen, setAccountOpen] = useState(false);
  const navRef = useRef(null);
  const accountRef = useRef(null);
  const accountTrigger = useRef(null);
  const accountPanel = useRef(null);
  const aoNavegar = () => { setAccountOpen(false); onMobileClose(); };

  // Gaveta e painel da conta: o mesmo comportamento do SideNav, repetido aqui
  // de propósito — o menu das outras páginas fica intocado nesta etapa.
  // Gaveta aberta: foco no primeiro destino, Esc fecha; quem devolve o foco ao
  // botão "Abrir menu" é a casca.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const alvo = primeiroFocavel(navRef.current);
    if (alvo) alvo.focus();
    function onKey(e) { if (e.key === 'Escape') onMobileClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);
  // Painel da conta: foco no primeiro item, fecha no clique fora e no Esc.
  useEffect(() => {
    if (!accountOpen) return undefined;
    const primeiroItem = primeiroFocavel(accountPanel.current);
    if (primeiroItem) primeiroItem.focus();
    function outside(e) { if (!accountRef.current?.contains(e.target)) setAccountOpen(false); }
    function escape(e) { if (e.key === 'Escape') { setAccountOpen(false); accountTrigger.current?.focus(); } }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);

  const nomeDaConta = `Conta: ${agent?.name || 'Atendente'}`;
  return <>
    {/* O véu fica um degrau abaixo da gaveta, como no SideNav. */}
    {mobileOpen && <div aria-hidden="true" onClick={onMobileClose} className="fixed inset-0 z-[calc(var(--z-nav)-1)] bg-black/50 md:hidden" />}
    <nav
      id="sidenav"
      ref={navRef}
      aria-label="Navegação principal"
      data-variante="mesa"
      onKeyDown={mobileOpen ? (evento) => prenderTabEm(navRef.current, evento) : undefined}
      className={`worknav ${mobileOpen ? 'is-mobile-open' : 'is-compact'}`}
    >
      <Marca companyName={companyName} status={companyNameStatus} />
      <div className="worknav-destinations">
        {DESTINOS.map((item) => {
          if (item.key === 'equipe') return <TeamPanel key={`equipe-${profileVersion}`} />;
          if (!hasLevel(agent, item.level)) return null;
          return <Destino key={item.key} item={item} onNavigate={aoNavegar} />;
        })}
      </div>
      <div className="worknav-personal">
        {/* A queda da conexão não tem indicador aqui: o aviso é um só, o da
            casca (AvisoDeConexao), também no celular, onde o trilho é gaveta. */}
        {agent?.role === 'agent' && (
          <button type="button" className="worknav-item" aria-label="Atendimentos encerrados" onClick={() => setClosedOpen(true)}>
            <IconeEncerrados /><span className="worknav-dica" aria-hidden="true">Atendimentos encerrados</span>
          </button>
        )}
        <button type="button" className="worknav-item" onClick={toggleMuted} aria-label={`Som da fila — ${muted ? 'Som desativado' : 'Som ativado'}`}>
          {muted ? <IconeSomDesativado /> : <IconeSom />}<span className="worknav-dica" aria-hidden="true">Som da fila: {muted ? 'desativado' : 'ativado'}</span>
        </button>
        {hasLevel(agent, CONFIGURACOES.level) && <Destino item={CONFIGURACOES} onNavigate={aoNavegar} />}
        <div className="worknav-account" ref={accountRef}>
          {accountOpen && <ul ref={accountPanel} className="worknav-account-panel" id="worknav-account-actions" aria-label="Opções da conta">
            {/* Só texto nos dois itens, iguais em tudo: a família DW ainda não
                tem ícone de perfil, e o avatar já é o acionador da conta. */}
            {/* O foco vai ao avatar ANTES de o perfil abrir: o item some com o
                painel, e é ao avatar que o foco volta quando o perfil fecha. */}
            <li><button type="button" onClick={() => { accountTrigger.current?.focus(); setAccountOpen(false); onProfileClick(); }}>Meu perfil</button></li>
            <li><button type="button" onClick={() => { setAccountOpen(false); logout(); }}>Sair</button></li>
          </ul>}
          <button type="button" ref={accountTrigger} className="worknav-account-trigger" aria-label={nomeDaConta} aria-expanded={accountOpen} aria-controls="worknav-account-actions" onClick={() => setAccountOpen((open) => !open)}>
            <AgentAvatar agentId={agent?.id} avatarPath={agent?.avatarPath} name={agent?.name} size={34} />
            <span className="worknav-dica" aria-hidden="true">{nomeDaConta}</span>
          </button>
        </div>
      </div>
    </nav>
    {closedOpen && (Encerrados
      ? <Encerrados onClose={() => setClosedOpen(false)} />
      : <p role="status" className="sr-only">Abrindo os atendimentos encerrados…</p>)}
    {alertDialog}
  </>;
}

// Memo: a página da mesa redesenha a cada evento de lista, e o trilho só
// muda com as próprias props (todas estáveis ou primitivas).
export default memo(TrilhoDaMesa);
