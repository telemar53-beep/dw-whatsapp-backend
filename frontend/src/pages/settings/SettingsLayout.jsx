import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { SETTINGS_SECTIONS, hasLevel, findSettingsItem } from '../../navigation/navItems';
import { IconLock } from '../../components/icons/WaIcons';

// O raio diz a profundidade: casca 26 > painel 22 > cartão 16 > controle 12.
const PANEL = 'overflow-clip rounded-[22px] border border-white/[0.07] backdrop-blur-2xl';
const ITEM =
  'relative flex items-center gap-2 rounded-[12px] px-2.5 py-[7px] text-[14px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70';

function SettingsLayout() {
  const { agent } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const selectValue = findSettingsItem(location.pathname)?.item.to ?? '';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
      <aside className={`${PANEL} flex min-w-0 flex-col bg-white/[0.09] lg:w-[244px] lg:shrink-0`}>
        <div className="shrink-0 px-4 pb-2 pt-4 lg:pt-5">
          <h2 className="font-display text-[18px] font-semibold leading-tight text-chat-text">Configurações</h2>
        </div>
        <div className="px-3 pb-3 lg:hidden">
          <label htmlFor="settings-section" className="sr-only">Seção</label>
          <select
            id="settings-section"
            value={selectValue}
            onChange={(e) => navigate(e.target.value)}
            className="w-full rounded-[12px] border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-[14px] text-chat-text outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70"
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
        </div>
        <nav aria-label="Seções de configurações" className="chat-scroll hidden min-h-0 flex-1 overflow-y-auto px-2 pb-4 lg:block">
          {SETTINGS_SECTIONS.map((group) => {
            const GroupIcon = group.icon;
            // Grupo de um item só com o mesmo nome (Equipe e acesso, Empresa): o
            // item vira a própria entrada, com o ícone do grupo, sem repetir o título.
            const single = group.items.length === 1 && group.items[0].label === group.group;
            return (
              <div key={group.groupKey} className="mt-4 first:mt-1">
                {!single && <p className="flex items-center gap-2 px-2.5 pb-1.5 text-[12.5px] font-medium text-chat-muted">
                  {GroupIcon && (
                    <span aria-hidden="true" className="shrink-0 text-chat-copper">
                      <GroupIcon size={15} />
                    </span>
                  )}
                  <span className="min-w-0 truncate">{group.group}</span>
                </p>}
                {group.items.map((item) => {
                  const allowed = hasLevel(agent, item.level);
                  return (
                    <NavLink
                      key={item.key}
                      to={item.to}
                      aria-disabled={allowed ? undefined : 'true'}
                      title={allowed ? item.description : 'Requer permissão de Canais e Integrações'}
                      className={({ isActive }) =>
                        `${ITEM} ${
                          isActive ? 'bg-white/[0.10] font-medium text-chat-text' : 'text-chat-muted hover:bg-white/[0.05] hover:text-chat-text'
                        } ${allowed ? '' : 'opacity-70'}`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span aria-hidden="true" className="absolute left-0 h-4 w-[3px] rounded-full bg-chat-orange" />}
                          {single && GroupIcon && (
                            <span aria-hidden="true" className="shrink-0 text-chat-copper">
                              <GroupIcon size={15} />
                            </span>
                          )}
                          <span className="min-w-0 truncate">{item.label}</span>
                          {!allowed && <span className="ml-auto shrink-0 text-chat-muted"><IconLock size={13} /></span>}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <section className={`${PANEL} flex min-h-0 min-w-0 flex-1 flex-col bg-white/[0.08]`}>
        <Outlet />
      </section>
    </div>
  );
}

export default SettingsLayout;
