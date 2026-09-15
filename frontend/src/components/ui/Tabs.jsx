import { NavLink } from 'react-router-dom';

const TAB_BASE =
  'relative shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';
const ACTIVE = 'border-chat-orange/70 text-chat-text';
const IDLE = 'border-white/[0.12] text-chat-muted hover:text-chat-text';

function Count({ value }) {
  if (!value) return null;
  return (
    <span className="absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-chat-orange px-1 text-[12px] font-semibold text-white">
      {value}
    </span>
  );
}

export function Tabs({ tabs, active, onChange, label = 'Abas' }) {
  function onKeyDown(event, index) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (onChange) onChange(next.key);
    const el = document.getElementById(`tab-${next.key}`);
    if (el) el.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-3.5 overflow-x-auto">
      {tabs.map((tab, index) =>
        tab.to ? (
          <NavLink
            key={tab.key}
            id={`tab-${tab.key}`}
            to={tab.to}
            className={({ isActive }) => `${TAB_BASE} ${isActive ? ACTIVE : IDLE}`}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {tab.label}
            <Count value={tab.count} />
          </NavLink>
        ) : (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`${TAB_BASE} ${active === tab.key ? ACTIVE : IDLE}`}
          >
            {tab.label}
            <Count value={tab.count} />
          </button>
        )
      )}
    </div>
  );
}
