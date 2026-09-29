import './settings.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, NavLink, useLocation, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { SETTINGS_SECTIONS, SETTINGS_AREAS, hasLevel, findSettingsItem } from '../../navigation/navItems';
import TrilhoDaMesa, { IconeDoMenu } from '../../components/TrilhoDaMesa';
import { IconeBuscar, IconeRecolher } from '../../components/icones';
import { IconeSemAcesso } from '../../components/icones/configuracoes';
import { SettingsIcon, temIcone } from './SettingsVisuals';

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function matchesTerm(item, term) {
  const text = normalized(`${item.label} ${item.group} ${item.description} ${item.terms}`);
  if (term.length > 2) return text.includes(term);
  return text.split(/[^a-z0-9]+/).includes(term);
}

const SEM_PERMISSAO = 'Requer permissão de Canais e Integrações';

// A seta da família: apontando para a frente (fechado) ou para baixo (aberto).
function Seta({ aberta = false }) {
  return <span className="cfg-seta" aria-hidden="true"><IconeRecolher tamanho={16} style={aberta ? undefined : { transform: 'rotate(-90deg)' }} /></span>;
}
function Cadeado() {
  return <span className="cfg-cadeado" aria-hidden="true"><IconeSemAcesso tamanho={15} /></span>;
}

// Casca de Configurações (Fatia S1, mockup aprovado): trilho índigo, diretório
// claro com busca e as três áreas, e o palco da página. No celular o diretório
// vira uma tela própria ("Áreas"), aberta por um botão do cabeçalho compacto:
// sem o <select> de antes. Estado só local; nada vai para contexto global.
function SettingsLayout() {
  const { agent } = useAuth();
  const location = useLocation();
  // A casca reserva os encaixes do trilho e do ícone do menu (AppShell.jsx).
  // Fora da casca (testes), não há encaixe.
  const contexto = useOutletContext() || {};
  const { openProfile, closeMobileNav, profileVersion, mobileNavOpen, encaixeDoTrilho, encaixeDoIcone } = contexto;
  const active = findSettingsItem(location.pathname);
  const [search, setSearch] = useState('');
  const [openGroup, setOpenGroup] = useState(null);
  const [areasAbertas, setAreasAbertas] = useState(false);
  const gatilhoDasAreas = useRef(null);
  const telaDasAreas = useRef(null);
  const estavamAbertas = useRef(false);

  // Trocar de página fecha o grupo aberto à mão (o da página ativa volta a
  // ficar aberto) e a tela das Áreas no celular.
  useEffect(() => {
    setOpenGroup(null);
    setAreasAbertas(false);
  }, [location.pathname]);

  // Foco da tela das Áreas: ao abrir, vai para a página ativa (ou o título);
  // ao fechar — Voltar, Esc ou escolha de uma página —, volta ao botão Áreas.
  useEffect(() => {
    if (areasAbertas) {
      estavamAbertas.current = true;
      const tela = telaDasAreas.current;
      const alvo = tela && (tela.querySelector('[aria-current=page]') || tela.querySelector('.cfg-diretorio-titulo'));
      if (alvo) alvo.focus();
      return;
    }
    if (!estavamAbertas.current) return;
    estavamAbertas.current = false;
    const botao = gatilhoDasAreas.current;
    if (botao && document.contains(botao)) botao.focus();
  }, [areasAbertas]);

  const expandedGroup = openGroup ?? active?.group.groupKey;
  const term = normalized(search.trim());
  const results = term
    ? SETTINGS_SECTIONS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.group }))).filter((item) => matchesTerm(item, term))
    : [];

  function aoTeclarNasAreas(event) {
    if (event.key === 'Escape' && areasAbertas) {
      event.stopPropagation();
      setAreasAbertas(false);
    }
  }

  function aoTeclarNaBusca(event) {
    if (event.key === 'Escape' && search) {
      event.stopPropagation();
      setSearch('');
    }
  }

  function linkDaPagina(item, { grupo, tamanho = 18, rotulo = item.label, extra = null } = {}) {
    const allowed = hasLevel(agent, item.level);
    return (
      <NavLink
        key={item.key}
        to={item.to}
        aria-label={grupo ? undefined : rotulo}
        aria-disabled={allowed ? undefined : 'true'}
        title={allowed ? item.description || item.label : SEM_PERMISSAO}
        onClick={() => { setSearch(''); setOpenGroup(null); }}
        className={`cfg-item ${grupo ? 'cfg-item-grupo' : 'cfg-item-pagina'} ${allowed ? '' : 'is-bloqueado'}`}
      >
        {({ isActive }) => (
          <>
            {temIcone(grupo ? grupo.groupKey : item.key)
              ? <SettingsIcon name={grupo ? grupo.groupKey : item.key} size={tamanho} />
              : <span className="cfg-sem-icone" aria-hidden="true" />}
            <span className="cfg-item-texto">{rotulo}{extra}</span>
            {allowed ? (grupo && !isActive ? <Seta /> : null) : <Cadeado />}
          </>
        )}
      </NavLink>
    );
  }

  const diretorio = term ? (
    <nav aria-label="Resultados da busca em configurações" className="settings-nav-list cfg-lista">
      <p className="cfg-resultados" role="status">
        {results.length === 0 ? 'Nenhuma configuração encontrada.' : results.length === 1 ? '1 resultado' : `${results.length} resultados`}
      </p>
      {results.map((item) => linkDaPagina(item, { extra: <small className="settings-search-group">{item.group}</small> }))}
    </nav>
  ) : (
    <nav aria-label="Seções de configurações" className="settings-nav-list cfg-lista">
      {SETTINGS_AREAS.map((area, indice) => (
        <div key={area} className="cfg-area" role="group" aria-labelledby={`cfg-area-${indice}`}>
          <p id={`cfg-area-${indice}`} className="cfg-area-rotulo">{area}</p>
          {SETTINGS_SECTIONS.filter((group) => group.area === area).map((group) => {
            // Grupo de uma página só: atalho direto, com o nome do grupo.
            if (group.items.length === 1) return linkDaPagina(group.items[0], { grupo: group, rotulo: group.group });
            const expanded = expandedGroup === group.groupKey;
            const todosBloqueados = group.items.every((item) => !hasLevel(agent, item.level));
            return (
              <div key={group.groupKey} className="cfg-grupo">
                <button
                  type="button"
                  data-settings-category={group.groupKey}
                  aria-expanded={expanded}
                  aria-controls={`settings-group-${group.groupKey}`}
                  onClick={() => setOpenGroup(expanded ? '' : group.groupKey)}
                  className={`cfg-item cfg-item-grupo ${todosBloqueados ? 'is-bloqueado' : ''}`}
                >
                  <SettingsIcon name={group.groupKey} size={18} />
                  <span className="cfg-item-texto">{group.group}</span>
                  <span className="cfg-fim">
                    {todosBloqueados && <Cadeado />}
                    <Seta aberta={expanded} />
                  </span>
                </button>
                <div id={`settings-group-${group.groupKey}`} hidden={!expanded} className="cfg-subitens">
                  {group.items.map((item) => linkDaPagina(item, { tamanho: 16 }))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div
      data-settings-page={active?.item.key}
      data-settings-group={active?.group.groupKey}
      className={`settings-workspace ${areasAbertas ? 'cfg-areas-abertas' : ''}`}
    >
      {/* Celular: cabeçalho compacto. O botão da gaveta do app (da casca) entra
          nesta mesma linha, à esquerda, pela folha da área. */}
      <div className="cfg-topo-celular">
        <p className="cfg-topo-titulo">{active?.item.label || 'Configurações'}</p>
        <button
          ref={gatilhoDasAreas}
          type="button"
          className="cfg-botao-areas"
          aria-expanded={areasAbertas}
          aria-controls="cfg-diretorio"
          onClick={() => setAreasAbertas(true)}
        >
          Áreas
          <IconeRecolher tamanho={16} />
        </button>
      </div>

      <aside id="cfg-diretorio" ref={telaDasAreas} aria-label="Seções de configurações" className="settings-nav cfg-diretorio" onKeyDown={aoTeclarNasAreas}>
        <div className="cfg-diretorio-topo">
          <button type="button" className="cfg-voltar" onClick={() => setAreasAbertas(false)}>
            <IconeRecolher tamanho={18} style={{ transform: 'rotate(90deg)' }} />
            Voltar
          </button>
          <h2 className="cfg-diretorio-titulo" tabIndex={-1}>Configurações</h2>
        </div>
        <div className="cfg-busca">
          <span className="cfg-busca-icone" aria-hidden="true"><IconeBuscar tamanho={18} /></span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={aoTeclarNaBusca}
            placeholder="Buscar configuração"
            aria-label="Buscar configuração"
          />
          {search && <button type="button" className="cfg-limpar" onClick={() => setSearch('')}>Limpar</button>}
        </div>
        {diretorio}
      </aside>

      {/* `role="main"` e não a tag <main>: a folha da área estiliza o conteúdo
          das páginas por `.settings-workspace :is(form,section,…)`, e o palco é
          justamente um <section>. O papel dá o landmark sem tocar na cascata. */}
      <section role="main" className="settings-stage">
        <Outlet />
      </section>

      {encaixeDoTrilho && createPortal(
        <TrilhoDaMesa onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} profileVersion={profileVersion} semEquipe />,
        encaixeDoTrilho
      )}
      {encaixeDoIcone && createPortal(<IconeDoMenu />, encaixeDoIcone)}
    </div>
  );
}

export default SettingsLayout;
