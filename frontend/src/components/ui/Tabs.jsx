import { NavLink } from 'react-router-dom';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

// Duas aparências para o mesmo componente:
// - pills (padrão): pílulas com borda, bolinha de contagem no canto — Supervisão.
// - underline: texto com traço laranja embaixo e contagem ao lado — lista do
//   Atendimento, onde três pílulas com bolinhas não cabiam com folga.
const PILL_BASE = `relative shrink-0 rounded-full border px-2.5 py-[5px] text-[13px] leading-5 transition ${FOCUS}`;
// Ativo tem borda laranja, fundo e texto cheio: o estado não fica só na cor da borda.
const PILL_ACTIVE = 'border-chat-orange/70 bg-chat-orange/[0.12] font-medium text-chat-text';
const PILL_IDLE = 'border-white/[0.12] text-chat-muted hover:border-white/25 hover:text-chat-text';

const LINE_BASE = `relative flex shrink-0 items-center gap-1 whitespace-nowrap px-0.5 pb-3 pt-1.5 text-[13px] leading-5 transition ${FOCUS}`;
const LINE_ACTIVE = 'font-medium text-chat-text';
const LINE_IDLE = 'text-chat-muted hover:text-chat-text';

function tabClass(look, active) {
  if (look === 'underline') return `${LINE_BASE} ${active ? LINE_ACTIVE : LINE_IDLE}`;
  return `${PILL_BASE} ${active ? PILL_ACTIVE : PILL_IDLE}`;
}

// A bolinha das pílulas sai 6px para fora (-top/-right-1.5). A faixa em volta
// tem 6px de padding e NÃO rola (overflow-x-auto arrasta overflow-y junto e
// cortava o topo da bolinha, além de criar uma barra de rolagem fantasma pelo
// transbordo de poucos px). Quando não cabe, a faixa quebra linha em vez de rolar.
function Count({ value, look, active }) {
  if (!value) return null;
  if (look === 'underline') {
    return (
      <span
        className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold leading-none ${
          active ? 'bg-chat-orange text-white' : 'bg-white/[0.10] text-chat-muted'
        }`}
      >
        {value}
      </span>
    );
  }
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-chat-orange px-1 text-[11px] font-semibold leading-none text-white">
      {value}
    </span>
  );
}

// O traço laranja fica colado na linha de baixo da faixa (-bottom-px cobre a borda).
function Underline() {
  return <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-chat-orange" />;
}

function stripClass(look) {
  if (look === 'underline') return 'flex min-w-0 flex-wrap gap-x-2.5 gap-y-1 border-b border-white/[0.08] px-3';
  return '-my-1.5 flex min-w-0 flex-wrap gap-2 px-1.5 py-1.5';
}

// Aba ligada a rota continua sendo um link: o NavLink marca a atual com
// aria-current="page". Trocar por role="tab" tiraria o papel de link, que é
// como o resto do app (e os testes da Task 4) enxergam estas abas.
function TabLink({ tab, look, onKeyDown }) {
  return (
    <NavLink id={`tab-${tab.key}`} to={tab.to} className={({ isActive }) => tabClass(look, isActive)} onKeyDown={onKeyDown}>
      {({ isActive }) => (
        <>
          {tab.label}
          <Count value={tab.count} look={look} active={isActive} />
          {look === 'underline' && isActive && <Underline />}
        </>
      )}
    </NavLink>
  );
}

export function Tabs({ tabs, active, onChange, label = 'Abas', look = 'pills' }) {
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
      <nav aria-label={label} className={stripClass(look)}>
        {tabs.map((tab, index) => (
          <TabLink key={tab.key} tab={tab} look={look} onKeyDown={(e) => onKeyDown(e, index)} />
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} className={stripClass(look)}>
      {tabs.map((tab, index) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={tabClass(look, isActive)}
          >
            {tab.label}
            <Count value={tab.count} look={look} active={isActive} />
            {look === 'underline' && isActive && <Underline />}
          </button>
        );
      })}
    </div>
  );
}
