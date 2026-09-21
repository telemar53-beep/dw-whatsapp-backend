import { SettingsIcon } from './SettingsVisuals';
import './settings.css';
import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { SETTINGS_SECTIONS, hasLevel, findSettingsItem } from '../../navigation/navItems';
import { IconLock, IconSearch } from '../../components/icons/WaIcons';

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function matchesTerm(item, term) {
  const text = normalized(`${item.label} ${item.group} ${item.description} ${item.terms}`);
  if (term.length > 2) return text.includes(term);
  return text.split(/[^a-z0-9]+/).includes(term);
}

// O raio diz a profundidade: casca 26 > painel 22 > cartão 16 > controle 12.
const PANEL = 'overflow-clip rounded-[22px] border border-white/[0.07] backdrop-blur-2xl';
const ITEM =
  'settings-nav-item relative flex items-center gap-2 rounded-[12px] px-2.5 py-[7px] text-[14px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring';

function SettingsLayout() {
  const { agent } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const active = findSettingsItem(location.pathname);
  const selectValue = active?.item.to ?? '';
  const [search, setSearch] = useState('');
  const [openGroup, setOpenGroup] = useState(null);
  useEffect(() => { setOpenGroup(null); }, [location.pathname]);
  const expandedGroup = openGroup ?? active?.group.groupKey;
  const term = normalized(search.trim());
  const results = term
    ? SETTINGS_SECTIONS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.group }))).filter((item) => matchesTerm(item, term))
    : [];

  return (
    <div data-settings-page={active?.item.key} data-settings-group={active?.group.groupKey} className="settings-workspace flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
      <aside className={`settings-nav ${PANEL} flex min-w-0 flex-col bg-[#2b343b]/95 lg:w-[264px] lg:shrink-0 ${term ? 'max-h-[40vh] lg:max-h-none' : ''}`}>
        <div className="settings-nav-heading shrink-0 px-4 pb-2 pt-4 lg:pt-5">
          <h2 className="font-display text-[18px] font-semibold leading-tight text-chat-text">Configurações</h2>
        </div>
        <div className="px-3 pb-3">
          <label className="settings-nav-search flex h-10 items-center gap-2 rounded-[10px] border border-white/[0.12] bg-[#354047] px-3 focus-within:border-chat-orange/60">
            <IconSearch size={17} />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar configuração" aria-label="Buscar configuração" className="min-w-0 flex-1 bg-transparent text-[13px] text-chat-text outline-none placeholder:text-chat-faint" />
          </label>
        </div>
        {!term && <div className="px-3 pb-3 lg:hidden">
          <label htmlFor="settings-section" className="sr-only">Seção</label>
          <select
            id="settings-section"
            value={selectValue}
            onChange={(e) => navigate(e.target.value)}
            className="w-full rounded-[12px] border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-[14px] text-chat-text outline-none transition"
          >
            {selectValue === '' && <option value="" disabled>Seção</option>}
            {SETTINGS_SECTIONS.map((group) => (
              <optgroup key={group.groupKey} label={group.group}>
                {group.items.map((item) => (
                  <option key={item.key} value={item.to}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>}
        {term ? (
          <nav aria-label="Resultados da busca em configurações" className="settings-nav-list chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {results.length === 0 && <p className="px-3 py-4 text-[13px] text-chat-muted">Nenhuma configuração encontrada.</p>}
            {results.map((item) => {
              const allowed = hasLevel(agent, item.level);
              return (
                <NavLink key={item.to} to={item.to} aria-label={item.label} title={allowed ? item.description || item.label : 'Acesso restrito'} aria-disabled={allowed ? undefined : 'true'} onClick={() => setSearch('')} className={({ isActive }) => `${ITEM} mb-1 ${isActive ? 'bg-white/[0.10] text-chat-text' : 'text-chat-muted hover:bg-white/[0.06] hover:text-chat-text'}`}>
                  <SettingsIcon name={item.key} size={16}/><span className="min-w-0 flex-1"><span className="block">{item.label}</span><small className="settings-search-group">{item.group}</small></span>
                  {!allowed && <IconLock size={13} />}
                </NavLink>
              );
            })}
          </nav>
        ) : <nav aria-label="Seções de configurações" className="settings-nav-list chat-scroll hidden min-h-0 flex-1 overflow-y-auto px-2 pb-4 lg:block">
          {SETTINGS_SECTIONS.map((group) => {
            const GroupIcon = group.icon;
            if (group.items.length === 1 && group.items[0].label === group.group) {
              const item = group.items[0];
              const allowed = hasLevel(agent, item.level);
              return <NavLink key={group.groupKey} to={item.to} aria-disabled={allowed ? undefined : 'true'} title={allowed ? item.description : 'Acesso restrito'} className={({ isActive }) => `settings-nav-solo mb-1 flex items-center gap-2 rounded-[12px] px-2.5 py-2.5 text-[13px] font-medium transition hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring ${isActive ? 'bg-white/[0.07] text-chat-text' : 'text-chat-muted'}`}>
                <span aria-hidden="true" className="shrink-0 text-chat-copper"><SettingsIcon name={group.groupKey} size={19}/></span>
                <span className="min-w-0">{item.label}</span>
                {!allowed && <IconLock size={13} />}
              </NavLink>;
            }
            const expanded = expandedGroup === group.groupKey;
            return (
              <div key={group.groupKey} className="settings-nav-group mb-1">
                <button
                  type="button"
                  data-settings-category={group.groupKey}
                  aria-expanded={expanded}
                  aria-controls={`settings-group-${group.groupKey}`}
                  onClick={() => setOpenGroup(expanded ? '' : group.groupKey)}
                  className={`settings-nav-group-trigger flex w-full items-center gap-2 rounded-[12px] px-2.5 py-2.5 text-left text-[13px] font-medium transition hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring ${expanded ? 'bg-white/[0.07] text-chat-text' : 'text-chat-muted'}`}
                >
                  {GroupIcon && (
                    <span aria-hidden="true" className="shrink-0 text-chat-copper">
                      <SettingsIcon name={group.groupKey} size={19}/>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{group.group}</span>
                  <span className="text-[11px] tabular-nums text-chat-faint">{group.items.length}</span>
                  <span aria-hidden="true" className={`text-chat-faint transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
                </button>
                <div id={`settings-group-${group.groupKey}`} hidden={!expanded} className="settings-nav-sublist mb-2 ml-[17px] border-l border-white/[0.10] pl-2">
                {group.items.map((item) => {
                  const allowed = hasLevel(agent, item.level);
                  return (
                    <NavLink
                      key={item.key}
                      to={item.to}
                      aria-disabled={allowed ? undefined : 'true'}
                      title={allowed ? item.description : 'Requer permissão de Canais e Integrações'}
                      onClick={() => setOpenGroup(null)}
                      className={({ isActive }) =>
                        `${ITEM} ${
                          isActive ? 'bg-white/[0.10] font-medium text-chat-text' : 'text-chat-muted hover:bg-white/[0.05] hover:text-chat-text'
                        } ${allowed ? '' : 'opacity-70'}`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span aria-hidden="true" className="settings-nav-marker absolute left-0 h-4 w-[3px] rounded-full bg-chat-orange" />}
                          <SettingsIcon name={item.key} size={15}/><span className="min-w-0">{item.label}</span>
                          {!allowed && <span className="ml-auto shrink-0 text-chat-muted"><IconLock size={13} /></span>}
                        </>
                      )}
                    </NavLink>
                  );
                })}
                </div>
              </div>
            );
          })}
        </nav>}
      </aside>
      <section className={`settings-stage ${PANEL} flex min-h-0 min-w-0 flex-1 flex-col bg-[#293238]/92`}>
        <Outlet />
      </section>
    </div>
  );
}

export default SettingsLayout;
