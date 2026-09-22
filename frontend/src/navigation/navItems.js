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
  { key: 'campanhas', label: 'Campanhas', to: '/campanhas', match: '/campanhas/*', icon: IconMegaphone, level: 'admin' },
  { key: 'relatorios', label: 'Relatórios', to: '/relatorios', match: '/relatorios/*', icon: IconChart, level: 'auth' },
  { key: 'configuracoes', label: 'Configurações', to: SETTINGS_BASE, match: `${SETTINGS_BASE}/*`, icon: IconSettings, level: 'admin' },
];

const s = (path) => `${SETTINGS_BASE}/${path}`;

export const SETTINGS_SECTIONS = [
  {
    group: 'WhatsApp e canais', groupKey: 'canais', icon: IconChannel,
    items: [
      { key: 'canais', label: 'Números conectados', to: s('canais'), level: 'admin', description: 'Conexão, status e atendimento de cada número de WhatsApp.' },
    ],
  },
  {
    group: 'Atendimento', groupKey: 'atendimento', icon: IconRules,
    items: [
      { key: 'horario', label: 'Horário de atendimento', to: s('regras/horario'), level: 'admin', description: 'Quando há atendente humano e o aviso fora do expediente.' },
      { key: 'boas-vindas', label: 'Boas-vindas', to: s('mensagens/boas-vindas'), level: 'admin', description: 'Mensagem enviada ao cliente quando inicia o contato.' },
      { key: 'abertura-encerramento', label: 'Abertura e encerramento', to: s('mensagens/abertura-encerramento'), level: 'admin', description: 'Mensagens ao assumir e finalizar um atendimento.' },
    ],
  },
  {
    group: 'IA e automação', groupKey: 'automacao', icon: IconSpark,
    items: [
      { key: 'triagem-menu', label: 'Triagem por menu', to: s('automacao/triagem-menu'), level: 'admin', description: 'O menu numerado que o cliente recebe antes de falar com um atendente.' },
      { key: 'ia', label: 'Atendimento com IA', to: s('automacao/ia'), level: 'admin', description: 'Quando a IA responde sozinha e quantas perguntas pode fazer.' },
      { key: 'identificacao', label: 'Identificação e comprovantes', to: s('automacao/identificacao'), level: 'admin', description: 'Como a IA confirma quem é o cliente e lê comprovantes.' },
      { key: 'transcricao', label: 'Transcrição de áudio', to: s('automacao/transcricao'), level: 'admin', description: 'Áudios do cliente viram texto para o atendente e para a IA.' },
      { key: 'noturno', label: 'Atendimento noturno', to: s('automacao/noturno'), level: 'admin', description: 'A janela em que a IA atende sozinha à noite.' },
      { key: 'ferramentas', label: 'Ações permitidas à IA', to: s('automacao/ferramentas'), level: 'admin', description: 'Consultas, desbloqueio e outras ações que a IA pode fazer no SGP.', terms: 'liberar confiança pix boleto ferramentas' },
    ],
  },
  {
    group: 'Mensagens', groupKey: 'mensagens', icon: IconQuickReply,
    items: [
      { key: 'avisos-cidade', label: 'Avisos por cidade', to: s('mensagens/avisos-cidade'), level: 'admin', description: 'Avisos automáticos para clientes de uma cidade.' },
      { key: 'respostas-rapidas', label: 'Respostas rápidas', to: s('mensagens/respostas-rapidas'), level: 'admin', description: 'Textos prontos usados pela equipe no chat.' },
      { key: 'templates', label: 'Templates WhatsApp', to: s('mensagens/templates'), level: 'admin', description: 'Modelos de mensagem aprovados para os canais oficiais.' },
    ],
  },
  {
    group: 'Equipe e permissões', groupKey: 'equipe', icon: IconTeam,
    items: [
      { key: 'usuarios', label: 'Usuários', to: s('equipe/usuarios'), level: 'admin', description: 'Contas e status dos atendentes.' },
      { key: 'setores', label: 'Setores', to: s('equipe/setores'), level: 'admin', description: 'Filas e times de atendimento.' },
      { key: 'perfis', label: 'Perfis e permissões', to: s('equipe/perfis'), level: 'admin', description: 'Acesso a páginas e ações por perfil.' },
    ],
  },
  {
    group: 'Integrações', groupKey: 'integracoes', icon: IconPlug,
    items: [
      { key: 'sgp-consultas', label: 'SGP: consultas', to: s('integracoes/sgp/consultas'), level: 'integrations', description: 'Dados do cliente, contratos e faturas no atendimento.' },
      { key: 'sgp-envios', label: 'SGP: Pix e boleto', to: s('integracoes/sgp/envios'), level: 'integrations', description: 'Envio de Pix e boleto pelos canais conectados.', terms: 'fatura cobrança financeiro' },
      { key: 'openai', label: 'OpenAI', to: s('integracoes/openai'), level: 'integrations', description: 'Credencial e modelo usados pela IA.', terms: 'chave integração' },
    ],
  },
  {
    group: 'Cadastros auxiliares', groupKey: 'cadastros', icon: IconTags,
    items: [
      { key: 'motivos', label: 'Motivos de atendimento', to: s('cadastros/motivos'), level: 'admin', description: 'Motivos usados ao finalizar conversas e nos relatórios.' },
      { key: 'cidades', label: 'Cidades', to: s('cadastros/cidades'), level: 'admin', description: 'Cidades usadas no cadastro e nos avisos.' },
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
  { from: s('regras/atribuicao'), to: s('mensagens/abertura-encerramento') },
  { from: s('integracoes/sgp-consulta'), to: s('integracoes/sgp/consultas') },
  { from: s('integracoes/sgp-canal'), to: s('integracoes/sgp/envios') },
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
