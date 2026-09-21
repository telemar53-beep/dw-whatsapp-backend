import { NavLink } from 'react-router-dom';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

// Duas aparências para o mesmo componente:
// - pills (padrão): pílulas com borda, bolinha de contagem no canto — Supervisão.
// - underline: texto com traço laranja embaixo e contagem ao lado — lista do
//   Atendimento, onde três pílulas com bolinhas não cabiam com folga.
const PILL_BASE = `relative shrink-0 rounded-full border px-2.5 py-[5px] text-[13px] leading-5 transition ${FOCUS}`;
// Ativo tem borda laranja, fundo e texto cheio: o estado não fica só na cor da borda.
const PILL_ACTIVE = 'border-chat-orange/70 bg-chat-orange/[0.12] font-medium text-chat-text';
const PILL_IDLE = 'border-white/[0.12] text-chat-muted hover:border-white/25 hover:text-chat-text';

const LINE_BASE = `relative flex shrink-0 items-center gap-1 whitespace-nowrap px-0.5 pb-3 pt-1.5 text-[13px] leading-5 transition ${FOCUS}`;
// `size="lg"`: a faixa do Atendimento, que fica sozinha numa coluna larga e pede texto maior.
const LINE_BASE_LG = `relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-1 pb-3 pt-2 text-[15px] font-medium leading-6 transition ${FOCUS}`;
const LINE_ACTIVE = 'font-medium text-chat-text';
const LINE_IDLE = 'text-chat-muted hover:text-chat-text';

// Segmentado: um trilho arredondado onde a aba ativa vira uma pílula laranja cheia
// e a contagem fica na quina de cada segmento — a faixa do Atendimento.
const SEG_BASE = `relative flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 py-2 text-[14px] leading-5 transition ${FOCUS}`;
const SEG_ACTIVE = 'bg-chat-orange font-semibold text-on-accent shadow-[0_6px_16px_-8px_rgba(244,83,31,0.9)]';
const SEG_IDLE = 'text-chat-muted hover:text-chat-text';

function tabClass(look, active, size) {
  if (look === 'segmented') return `${SEG_BASE} ${active ? SEG_ACTIVE : SEG_IDLE}`;
  if (look === 'underline') return `${size === 'lg' ? LINE_BASE_LG : LINE_BASE} ${active ? LINE_ACTIVE : LINE_IDLE}`;
  return `${PILL_BASE} ${active ? PILL_ACTIVE : PILL_IDLE}`;
}

// A bolinha das pílulas sai 6px para fora (-top/-right-1.5). A faixa em volta
// tem 6px de padding e NÃO rola (overflow-x-auto arrasta overflow-y junto e
// cortava o topo da bolinha, além de criar uma barra de rolagem fantasma pelo
// transbordo de poucos px). Quando não cabe, a faixa quebra linha em vez de rolar.
function Count({ value, look, active, size }) {
  if (!value) return null;
  if (look === 'segmented') {
    return (
      <span
        className={`absolute -right-1 -top-1.5 flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11.5px] font-bold leading-none shadow-[0_2px_6px_rgba(0,0,0,0.35)] ${
          active ? 'bg-white text-on-accent' : 'bg-white/[0.14] text-chat-muted'
        }`}
      >
        {value}
      </span>
    );
  }
  if (look === 'underline') {
    const dims = size === 'lg' ? 'h-[22px] min-w-[22px] px-1.5 text-[12px]' : 'h-[18px] min-w-[18px] px-1 text-[10.5px]';
    return (
      <span
        className={`flex ${dims} items-center justify-center rounded-full font-semibold leading-none ${
          active ? 'bg-chat-orange text-on-accent' : 'bg-white/[0.10] text-chat-muted'
        }`}
      >
        {value}
      </span>
    );
  }
  return (
    <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-chat-orange px-1 text-[11px] font-semibold leading-none text-on-accent">
      {value}
    </span>
  );
}

// O traço laranja fica colado na linha de baixo da faixa (-bottom-px cobre a borda).
function Underline() {
  return <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-chat-orange" />;
}

function stripClass(look, align, size) {
  if (look === 'segmented') return 'flex w-full gap-1 rounded-full border border-white/[0.06] bg-white/[0.08] p-1';
  if (look === 'underline') {
    return `flex min-w-0 flex-wrap ${size === 'lg' ? 'gap-x-5' : 'gap-x-2.5'} gap-y-1 border-b border-white/[0.08] px-3 ${align === 'center' ? 'justify-center' : ''}`;
  }
  return '-my-1.5 flex min-w-0 flex-wrap gap-2 px-1.5 py-1.5';
}

// Aba ligada a rota continua sendo um link: o NavLink marca a atual com
// aria-current="page". Trocar por role="tab" tiraria o papel de link, que é
// como o resto do app (e os testes da Task 4) enxergam estas abas.
function TabLink({ tab, look, size, onKeyDown }) {
  return (
    <NavLink id={`tab-${tab.key}`} to={tab.to} className={({ isActive }) => tabClass(look, isActive, size)} onKeyDown={onKeyDown}>
      {({ isActive }) => (
        <>
          {tab.label}
          <Count value={tab.count} look={look} active={isActive} size={size} />
          {look === 'underline' && isActive && <Underline />}
        </>
      )}
    </NavLink>
  );
}

export function Tabs({ tabs, active, onChange, label = 'Abas', look = 'pills', align = 'start', size = 'md' }) {
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
      <nav aria-label={label} className={stripClass(look, align, size)}>
        {tabs.map((tab, index) => (
          <TabLink key={tab.key} tab={tab} look={look} size={size} onKeyDown={(e) => onKeyDown(e, index)} />
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} className={stripClass(look, align, size)}>
      {tabs.map((tab, index) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            // Só a aba ATIVA aponta para um painel: o painel da aba inativa
            // não é montado, e `aria-controls` para um id inexistente é uma
            // referência quebrada.
            aria-controls={isActive ? `tabpanel-${tab.key}` : undefined}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={tabClass(look, isActive, size)}
          >
            {tab.label}
            <Count value={tab.count} look={look} active={isActive} size={size} />
            {look === 'underline' && isActive && <Underline />}
          </button>
        );
      })}
    </div>
  );
}
