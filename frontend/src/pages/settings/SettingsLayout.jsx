import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { SETTINGS_SECTIONS, hasLevel, findSettingsItem } from '../../navigation/navItems';
import { IconLock } from '../../components/icons/WaIcons';

function SettingsLayout() {
  const { agent } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const selectValue = findSettingsItem(location.pathname)?.item.to ?? '';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">
      <aside className="flex min-w-0 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.09] backdrop-blur-2xl md:w-[220px] md:shrink-0">
        <div className="shrink-0 px-3.5 pb-2 pt-4 md:pt-5">
          <h2 className="font-display text-[18px] font-semibold leading-tight text-chat-text">Configurações</h2>
        </div>
        <div className="px-3 pb-3 md:hidden">
          <label htmlFor="settings-section" className="sr-only">Seção</label>
          <select
            id="settings-section"
            value={selectValue}
            onChange={(e) => navigate(e.target.value)}
            className="w-full rounded-[12px] border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-[14px] text-chat-text"
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
        <nav aria-label="Seções de configurações" className="chat-scroll hidden min-h-0 flex-1 overflow-y-auto px-1.5 pb-4 md:block">
          {SETTINGS_SECTIONS.map((group) => (
            <div key={group.groupKey}>
              <p className="px-2.5 pb-1 pt-3.5 text-[11.5px] font-medium uppercase tracking-wide text-chat-faint">{group.group}</p>
              {group.items.map((item) => {
                const allowed = hasLevel(agent, item.level);
                return (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    aria-disabled={allowed ? undefined : 'true'}
                    title={allowed ? item.description : 'Requer permissão de Canais e Integrações'}
                    className={({ isActive }) =>
                      `relative flex items-center gap-2 rounded-[12px] px-2.5 py-[7px] text-[14px] transition ${
                        isActive ? 'bg-white/[0.10] font-medium text-chat-text' : 'text-chat-muted hover:bg-white/[0.05] hover:text-chat-text'
                      } ${allowed ? '' : 'opacity-60'}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span aria-hidden="true" className="absolute left-0 h-4 w-[3px] rounded-full bg-chat-orange" />}
                        <span className="truncate">{item.label}</span>
                        {!allowed && <span className="ml-auto shrink-0 text-chat-faint"><IconLock size={13} /></span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.08] backdrop-blur-2xl">
        <Outlet />
      </section>
    </div>
  );
}

export default SettingsLayout;
