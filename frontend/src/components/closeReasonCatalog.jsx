// Catálogo visual dos motivos de contato. Os motivos vivem no banco só com o
// nome (o admin cadastra o que quiser); o ícone, a cor e a legenda de cada um
// são achados aqui pelo nome normalizado. Nome fora do catálogo cai no
// ícone neutro, sem legenda — nunca some do modal.

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

function Svg({ children, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...STROKE} strokeWidth={2.1} {...rest}>
      {children}
    </svg>
  );
}

const icons = {
  cancel: (
    <Svg>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
      <path d="M14 3v5h5" />
      <path d="M14 3l5 5" />
      <path d="M9 9h2M9 13h3" />
      <path d="M15 15l5 5M20 15l-5 5" />
    </Svg>
  ),
  dollar: (
    <Svg>
      <path d="M12 2v20" />
      <path d="M17 6.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
    </Svg>
  ),
  wrench: (
    <Svg>
      <path d="M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9L11 21.8a2.1 2.1 0 0 1-3-3l9.6-9.6a4.5 4.5 0 0 0-3-2.9z" />
      <path d="M14.7 6.3L17.5 3l3.5 3.5-3.3 2.8" />
    </Svg>
  ),
  pin: (
    <Svg>
      <path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  ),
  refresh: (
    <Svg>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </Svg>
  ),
  robot: (
    <Svg>
      <rect x="4" y="9" width="16" height="11" rx="3" />
      <path d="M12 9V5" />
      <circle cx="12" cy="3.8" r="1.2" />
      <path d="M2 14v2M22 14v2" />
      <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 17h5" />
    </Svg>
  ),
  bellOff: (
    <Svg>
      <path d="M8.6 5.2A6 6 0 0 1 18 10v3l2 3H9" />
      <path d="M6 10v3l-2 3h4" />
      <path d="M10 20a2 2 0 0 0 4 0" />
      <path d="M3 3l18 18" />
    </Svg>
  ),
  headset: (
    <Svg>
      <path d="M4 14v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19v1a2 2 0 0 1-2 2h-4" />
    </Svg>
  ),
  key: (
    <Svg>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2L20 3" />
      <path d="M17 6l2.5 2.5M14.5 8.5L17 11" />
    </Svg>
  ),
  tag: (
    <Svg>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
};

// Cores fixas (não tokens): a tinta de cada ícone é parte da identidade do
// motivo, igual no tema claro e no escuro.
const TONES = {
  red: { color: '#f4646a', bg: 'rgba(244, 100, 106, 0.14)' },
  green: { color: '#3ddc97', bg: 'rgba(61, 220, 151, 0.14)' },
  blue: { color: '#4f9cf9', bg: 'rgba(79, 156, 249, 0.14)' },
  violet: { color: '#a678f0', bg: 'rgba(166, 120, 240, 0.14)' },
  indigo: { color: '#8b7cf6', bg: 'rgba(139, 124, 246, 0.14)' },
  gray: { color: '#d8d3ce', bg: 'rgba(216, 211, 206, 0.12)' },
  orange: { color: '#f4531f', bg: 'rgba(244, 83, 31, 0.14)' },
  pink: { color: '#f2647f', bg: 'rgba(242, 100, 127, 0.14)' },
  neutral: { color: '#b6b0ab', bg: 'rgba(182, 176, 171, 0.12)' },
};

const CATALOG = {
  cancelamento: { icon: 'cancel', tone: 'red', hint: 'Solicitação de cancelamento' },
  financeiro: { icon: 'dollar', tone: 'green', hint: 'Boletos, pagamentos, faturas' },
  instalacao: { icon: 'wrench', tone: 'blue', hint: 'Nova instalação' },
  'mudanca de endereco': { icon: 'pin', tone: 'violet', hint: 'Alteração de endereço' },
  reativacao: { icon: 'refresh', tone: 'green', hint: 'Reativar serviço' },
  'resolvido pela ia': { icon: 'robot', tone: 'indigo', hint: 'Atendimento finalizado pela IA' },
  'sem resposta': { icon: 'bellOff', tone: 'gray', hint: 'Cliente não respondeu' },
  'suporte tecnico': { icon: 'headset', tone: 'orange', hint: 'Dúvidas, problemas técnicos' },
  'troca de senha': { icon: 'key', tone: 'pink', hint: 'Alteração de senha do cliente' },
};

export function normalizeReasonName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Nome cadastrado diferente do catálogo (ex.: "Suporte", "Senha", "Endereço")
// ainda acha o ícone certo pela palavra-chave. Ordem importa: a primeira que
// bater vence.
const ALIASES = [
  ['cancel', 'cancelamento'],
  ['financ', 'financeiro'],
  ['boleto', 'financeiro'],
  ['pagamento', 'financeiro'],
  ['fatura', 'financeiro'],
  ['instal', 'instalacao'],
  ['endereco', 'mudanca de endereco'],
  ['mudanca', 'mudanca de endereco'],
  ['reativ', 'reativacao'],
  [' ia', 'resolvido pela ia'],
  ['sem resposta', 'sem resposta'],
  ['nao respondeu', 'sem resposta'],
  ['suporte', 'suporte tecnico'],
  ['tecnic', 'suporte tecnico'],
  ['senha', 'troca de senha'],
];

function findEntry(name) {
  const key = normalizeReasonName(name);
  if (CATALOG[key]) return CATALOG[key];
  const padded = ` ${key} `;
  const alias = ALIASES.find(([needle]) => padded.includes(needle));
  return alias ? CATALOG[alias[1]] : null;
}

export function describeReason(name) {
  const entry = findEntry(name);
  const tone = TONES[entry ? entry.tone : 'neutral'];
  return {
    icon: icons[entry ? entry.icon : 'tag'],
    color: tone.color,
    background: tone.bg,
    hint: entry ? entry.hint : null,
  };
}

export const closeReasonHeaderIcon = (
  <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" {...STROKE} strokeWidth={1.8}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v4A2.5 2.5 0 0 1 13.5 12H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 9.5z" />
    <path d="M8 7h5M8 9.5h3" />
    <path d="M18 9h.5A2.5 2.5 0 0 1 21 11.5v4a2.5 2.5 0 0 1-2.5 2.5H18v3l-3.5-3h-3A2.5 2.5 0 0 1 9 15.5" />
  </svg>
);

export const checkCircleIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" {...STROKE}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.3 2.3 4.7-5" />
  </svg>
);

export const closeIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" {...STROKE} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
