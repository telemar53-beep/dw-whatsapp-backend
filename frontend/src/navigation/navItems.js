import {
  IconChats, IconTeam, IconMegaphone, IconChart, IconSettings,
  IconChannel, IconSpark, IconRules, IconQuickReply, IconPlug, IconTags, IconBuilding,
} from '../components/icons/WaIcons';

// Os três níveis espelham src/auth/auth.middleware.js: requireAuth,
// requireRole('admin') (admin+manager) e requireIntegrationsAccess.
export function hasLevel(agent, level) {
  if (!agent) return false;
  if (level === 'auth') return true;
  const adminLevel = agent.role === 'admin' || agent.role === 'manager';
  if (level === 'admin') return adminLevel;
  if (level === 'integrations') {
    return agent.role === 'admin' || (agent.role === 'manager' && agent.canManageIntegrations === true);
  }
  return false;
}

export const SETTINGS_BASE = '/configuracoes';

export const NAV_ITEMS = [
  { key: 'atendimento', label: 'Atendimento', to: '/', match: '/', icon: IconChats, level: 'auth' },
  { key: 'supervisao', label: 'Supervisão', to: '/supervisao', match: '/supervisao/*', icon: IconTeam, level: 'admin' },
  { key: 'campanhas', label: 'Campanhas', to: '/campanhas', match: '/campanhas/*', icon: IconMegaphone, level: 'auth' },
  { key: 'relatorios', label: 'Relatórios', to: '/relatorios', match: '/relatorios/*', icon: IconChart, level: 'auth' },
  { key: 'configuracoes', label: 'Configurações', to: SETTINGS_BASE, match: `${SETTINGS_BASE}/*`, icon: IconSettings, level: 'admin' },
];

const s = (path) => `${SETTINGS_BASE}/${path}`;

export const SETTINGS_SECTIONS = [
  {
    group: 'Canais WhatsApp', groupKey: 'canais', icon: IconChannel,
    items: [
      { key: 'canais', label: 'Canais', to: s('canais'), level: 'admin', description: 'Os números de WhatsApp ligados ao atendimento.' },
    ],
  },
  {
    group: 'Automação e IA', groupKey: 'automacao', icon: IconSpark,
    items: [
      { key: 'triagem-menu', label: 'Triagem por menu', to: s('automacao/triagem-menu'), level: 'admin', description: 'O menu numerado que o cliente recebe antes de falar com um atendente.' },
      { key: 'ia', label: 'Atendimento e triagem com IA', to: s('automacao/ia'), level: 'admin', description: 'Quando a IA responde sozinha e quantas perguntas pode fazer.' },
      { key: 'identificacao', label: 'Identificação e comprovantes', to: s('automacao/identificacao'), level: 'admin', description: 'Como a IA confirma quem é o cliente e lê comprovantes.' },
      { key: 'transcricao', label: 'Transcrição de áudio', to: s('automacao/transcricao'), level: 'admin', description: 'Áudios do cliente viram texto para o atendente e para a IA.' },
      { key: 'noturno', label: 'Atendimento noturno', to: s('automacao/noturno'), level: 'admin', description: 'A janela em que a IA atende sozinha à noite.' },
      { key: 'ferramentas', label: 'Ferramentas autorizadas', to: s('automacao/ferramentas'), level: 'admin', description: 'O que a IA pode consultar e fazer no SGP.' },
    ],
  },
  {
    group: 'Regras de atendimento', groupKey: 'regras', icon: IconRules,
    items: [
      { key: 'atribuicao', label: 'Atribuição', to: s('regras/atribuicao'), level: 'admin', description: 'Mensagens automáticas ao assumir e ao encerrar um atendimento.' },
      { key: 'horario', label: 'Horário de atendimento', to: s('regras/horario'), level: 'admin', description: 'Quando há atendente humano e o aviso fora do expediente.' },
    ],
  },
  {
    group: 'Mensagens e templates', groupKey: 'mensagens', icon: IconQuickReply,
    items: [
      { key: 'boas-vindas', label: 'Boas-vindas', to: s('mensagens/boas-vindas'), level: 'admin', description: 'A primeira mensagem que cada canal envia ao cliente.' },
      { key: 'avisos-cidade', label: 'Avisos por cidade', to: s('mensagens/avisos-cidade'), level: 'admin', description: 'Avisos de instabilidade ou manutenção por região.' },
      { key: 'respostas-rapidas', label: 'Respostas rápidas', to: s('mensagens/respostas-rapidas'), level: 'admin', description: 'Textos prontos que o atendente insere com um clique.' },
      { key: 'templates', label: 'Templates WhatsApp', to: s('mensagens/templates'), level: 'admin', description: 'Mensagens aprovadas pela Meta para os canais oficiais.' },
    ],
  },
  {
    group: 'Equipe e acesso', groupKey: 'equipe', icon: IconTeam,
    // Uma entrada só: Usuários, Setores e Perfis são abas dentro da página.
    items: [
      { key: 'equipe', label: 'Equipe e acesso', to: s('equipe'), level: 'admin', description: 'Usuários, setores e perfis de acesso.' },
    ],
  },
  {
    group: 'Integrações', groupKey: 'integracoes', icon: IconPlug,
    items: [
      { key: 'sgp-consulta', label: 'Consulta ao SGP', to: s('integracoes/sgp-consulta'), level: 'integrations', description: 'O chat consulta cliente, contrato e fatura no SGP.' },
      { key: 'sgp-canal', label: 'SGP por canal', to: s('integracoes/sgp-canal'), level: 'integrations', description: 'O SGP dispara mensagens pelo chat com uma chave por canal.' },
      { key: 'openai', label: 'OpenAI', to: s('integracoes/openai'), level: 'integrations', description: 'Credencial, modelo e teste de conexão da IA.' },
    ],
  },
  {
    group: 'Cadastros auxiliares', groupKey: 'cadastros', icon: IconTags,
    items: [
      { key: 'motivos', label: 'Motivos de atendimento', to: s('cadastros/motivos'), level: 'admin', description: 'O motivo escolhido ao encerrar um atendimento.' },
      { key: 'cidades', label: 'Cidades', to: s('cadastros/cidades'), level: 'admin', description: 'As cidades do cadastro do cliente e dos avisos por região.' },
    ],
  },
  {
    group: 'Empresa', groupKey: 'empresa', icon: IconBuilding,
    items: [
      { key: 'empresa', label: 'Empresa', to: s('empresa'), level: 'admin', description: 'Nome da empresa e nomes aceitos na conferência de comprovantes.' },
    ],
  },
];

export const LEGACY_REDIRECTS = [
  { from: '/admin/dashboard', to: '/supervisao' },
  { from: '/admin/channels', to: s('canais') },
  { from: '/metrics', to: '/relatorios' },
  { from: '/campaigns', to: '/campanhas' },
  { from: '/campaigns/:id', to: '/campanhas/:id' },
];

export function firstAllowedSettingsPath(agent) {
  for (const group of SETTINGS_SECTIONS) {
    for (const item of group.items) {
      if (hasLevel(agent, item.level)) return item.to;
    }
  }
  return null;
}

export function findSettingsItem(pathname) {
  for (const group of SETTINGS_SECTIONS) {
    for (const item of group.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return { group, item };
    }
  }
  return null;
}
