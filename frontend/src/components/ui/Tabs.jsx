import { NavLink } from 'react-router-dom';

const TAB_BASE =
  'relative shrink-0 rounded-full border px-2.5 py-[5px] text-[13px] leading-5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';
// Ativo tem borda laranja, fundo e texto cheio: o estado não fica só na cor da borda.
const ACTIVE = 'border-chat-orange/70 bg-chat-orange/[0.12] font-medium text-chat-text';
const IDLE = 'border-white/[0.12] text-chat-muted hover:border-white/25 hover:text-chat-text';

// A bolinha sai 6px para fora da pílula (-top/-right-1.5). A faixa em volta
// tem 6px de padding e NÃO rola (overflow-x-auto arrasta overflow-y junto e
// cortava o topo da bolinha, além de criar uma barra de rolagem fantasma pelo
// transbordo de poucos px). Quando não cabe, a faixa quebra linha em vez de rolar.
function Count({ value }) {
  if (!value) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-chat-orange px-1 text-[11px] font-semibold leading-none text-white">
      {value}
    </span>
  );
}

// Aba ligada a rota continua sendo um link: o NavLink marca a atual com
// aria-current="page". Trocar por role="tab" tiraria o papel de link, que é
// como o resto do app (e os testes da Task 4) enxergam estas abas.
function TabLink({ tab, onKeyDown }) {
  return (
    <NavLink
      id={`tab-${tab.key}`}
      to={tab.to}
      className={({ isActive }) => `${TAB_BASE} ${isActive ? ACTIVE : IDLE}`}
      onKeyDown={onKeyDown}
    >
      {tab.label}
      <Count value={tab.count} />
    </NavLink>
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

  // Abas ligadas a rota são links, não abas: role="tablist"/role="tab" exige
  // que os filhos sejam abas, e um link ali dentro é semântica inválida. Um
  // <nav> com links comuns (marcados por aria-current, via TabLink) é o papel
  // certo para navegação entre páginas que só parece com abas visualmente.
  const isRouteTabs = tabs.length > 0 && tabs.every((tab) => tab.to);

  if (isRouteTabs) {
    return (
      <nav aria-label={label} className="-my-1.5 flex min-w-0 flex-wrap gap-2 px-1.5 py-1.5">
        {tabs.map((tab, index) => (
          <TabLink key={tab.key} tab={tab} onKeyDown={(e) => onKeyDown(e, index)} />
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} className="-my-1.5 flex min-w-0 flex-wrap gap-2 px-1.5 py-1.5">
      {tabs.map((tab, index) => (
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
      ))}
    </div>
  );
}
