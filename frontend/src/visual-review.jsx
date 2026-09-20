// Ambiente local, isolado da API: monta os componentes reais para revisão visual.
// Nenhuma ação de escrita é enviada ao backend.
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppShell from './components/AppShell';
import DashboardPage from './pages/DashboardPage';
import ReportsPage from './pages/ReportsPage';
import SupervisionPage from './pages/SupervisionPage';
import CampaignsPage from './pages/CampaignsPage';
import CampaignDetailPage from './pages/CampaignDetailPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import SettingsIndex from './pages/settings/SettingsIndex';
import ChannelsListPage from './pages/settings/channels/ChannelsListPage';
import ChannelDetailPage from './pages/settings/channels/ChannelDetailPage';
import ChannelConnectionTab from './pages/settings/channels/ChannelConnectionTab';
import ChannelBehaviorTab from './pages/settings/channels/ChannelBehaviorTab';
import TeamLayout from './pages/settings/team/TeamLayout';
import UsersPage from './pages/settings/team/UsersPage';
import SectorsPage from './pages/settings/team/SectorsPage';
import RolesPage from './pages/settings/team/RolesPage';
import RegistersLayout from './pages/settings/registers/RegistersLayout';
import ReasonsPage from './pages/settings/registers/ReasonsPage';
import CitiesPage from './pages/settings/registers/CitiesPage';
import CompanyPage from './pages/settings/CompanyPage';
import MessagesLayout from './pages/settings/messages/MessagesLayout';
import WelcomePage from './pages/settings/messages/WelcomePage';
import CityNoticesPage from './pages/settings/messages/CityNoticesPage';
import QuickRepliesPage from './pages/settings/messages/QuickRepliesPage';
import TemplatesPage from './pages/settings/messages/TemplatesPage';
import AssignmentPage from './pages/settings/rules/AssignmentPage';
import BusinessHoursPage from './pages/settings/rules/BusinessHoursPage';
import IntegrationsLayout from './pages/settings/integrations/IntegrationsLayout';
import SgpIntegrationLayout from './pages/settings/integrations/SgpIntegrationLayout';
import SgpQueryPage from './pages/settings/integrations/SgpQueryPage';
import SgpChannelPage from './pages/settings/integrations/SgpChannelPage';
import OpenAiPage from './pages/settings/integrations/OpenAiPage';
import MenuTriagePage from './pages/settings/automation/MenuTriagePage';
import AiTriagePage from './pages/settings/automation/AiTriagePage';
import IdentificationPage from './pages/settings/automation/IdentificationPage';
import TranscriptionPage from './pages/settings/automation/TranscriptionPage';
import NightModePage from './pages/settings/automation/NightModePage';
import AiToolsPage from './pages/settings/automation/AiToolsPage';
import './index.css';

const now = Date.now();
const names = ['Ana Beatriz Figueiredo', 'Carlos Eduardo Lima', 'Mariana Santos', 'João Pedro Alves', 'Patrícia Gomes', 'Roberto Nascimento', 'Fernanda Costa', 'Rafael Martins', 'Juliana Ribeiro', 'Ricardo Souza', 'Tatiane Oliveira', 'Larissa Almeida', 'Bruno Ferreira', 'Camila Rocha', 'Pedro Henrique'];
const conversations = names.map((name, i) => ({ id: `review-${i}`, contactId: `contact-${i}`, contactDisplayName: name, contactPhoneNumber: `+55 11 98765-${String(4321 + i).padStart(4, '0')}`, contactCityName: i % 2 ? 'Campinas' : 'São Paulo', sectorName: i % 3 ? 'Suporte Técnico' : 'Financeiro', assignedAgentId: 'review-agent', assignedAgentName: 'Lucas Silva', status: 'assigned', channelName: 'DW Telecom', channelType: 'meta_cloud', lastMessageContent: i % 2 ? 'Preciso de ajuda com o acesso.' : 'Consegue me enviar a segunda via?', lastMessageDirection: i % 2 ? 'outbound' : 'inbound', lastMessageAt: new Date(now - i * 12 * 60000).toISOString(), createdAt: new Date(now - (i + 1) * 35 * 60000).toISOString() }));
const messages = [
  { id: 'm1', direction: 'inbound', content: 'Olá, boa tarde! Preciso da segunda via da minha fatura, por favor.', messageType: 'text', createdAt: new Date(now - 20 * 60000).toISOString() },
  { id: 'm2', direction: 'outbound', content: 'Olá, Ana! Claro, vou verificar aqui para você.', messageType: 'text', sentBy: 'human', status: 'read', createdAt: new Date(now - 19 * 60000).toISOString() },
  { id: 'm3', direction: 'outbound', content: 'Sua solicitação foi direcionada ao Financeiro.', messageType: 'text', sentBy: 'ai', status: 'read', createdAt: new Date(now - 17 * 60000).toISOString() },
  { id: 'm4', direction: 'inbound', content: 'Obrigada! Ainda preciso pagar hoje.', messageType: 'text', createdAt: new Date(now - 15 * 60000).toISOString() },
];
const channels = [{ id: 'channel-1', name: 'DW Telecom', type: 'meta_cloud', status: 'connected', phoneNumber: '+55 11 4000-0000', active: true }];
const agents = [{ id: 'review-agent', name: 'Lucas Silva', email: 'lucas@exemplo.local', role: 'admin', active: true, online: true, activeConversations: 15, sectors: [{ id: 'sector-1', name: 'Financeiro' }] }, { id: 'review-agent-2', name: 'Mariana Costa', email: 'mariana@exemplo.local', role: 'agent', active: true, online: true, activeConversations: 3, sectors: [{ id: 'sector-2', name: 'Suporte Técnico' }] }];
const baseData = {
  '/api/public/company': { name: 'DW Telecom' },
  '/api/conversations/mine': conversations,
  '/api/conversations/queue': [{ ...conversations[14], id: 'queue-1', assignedAgentId: null, status: 'waiting' }],
  '/api/agents': agents,
  '/api/admin/agents': agents,
  '/api/channels': channels,
  '/api/admin/channels': channels,
  '/api/sectors': [{ id: 'sector-1', name: 'Financeiro', active: true }, { id: 'sector-2', name: 'Suporte Técnico', active: true }],
  '/api/admin/sectors': [{ id: 'sector-1', name: 'Financeiro', active: true }, { id: 'sector-2', name: 'Suporte Técnico', active: true }],
  '/api/reasons': [{ id: 'reason-1', name: 'Resolvido', active: true }],
  '/api/admin/reasons': [{ id: 'reason-1', name: 'Resolvido', active: true }],
  '/api/cities': [{ id: 'city-1', name: 'São Paulo', active: true }],
  '/api/admin/cities/notices': [],
  '/api/admin/templates': [],
  '/api/quick-replies': [],
  '/api/campaigns': [],
  '/api/admin/dashboard/conversations': { inProgress: conversations, waiting: [{ ...conversations[14], id: 'queue-1', status: 'waiting' }], inAutomation: [], closedTodayCount: 0 },
  '/api/admin/integrations/sgp': [],
  '/api/admin/ai/tools': [],
  '/api/admin/triage': { enabled: false, options: [] },
  '/api/admin/ai/config': { mode: 'off', enabled: false },
  '/api/admin/company': { name: 'DW Telecom' },
  '/api/admin/assignment-message': { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] },
  '/api/admin/business-hours': {},
  '/api/admin/integrations/sgp-query-config': {},
  '/api/agents/me': agents[0],
};

const previousToken = localStorage.getItem('dw_token') === 'visual-review-only' ? null : localStorage.getItem('dw_token');
const previousAgent = localStorage.getItem('dw_token') === 'visual-review-only' ? null : localStorage.getItem('dw_agent');
localStorage.setItem('dw_token', 'visual-review-only');
localStorage.setItem('dw_agent', JSON.stringify(agents[0]));
window.addEventListener('pagehide', () => {
  if (previousToken === null) localStorage.removeItem('dw_token');
  else localStorage.setItem('dw_token', previousToken);
  if (previousAgent === null) localStorage.removeItem('dw_agent');
  else localStorage.setItem('dw_agent', previousAgent);
});
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.origin);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '3000') throw new Error('Revisão local: destino externo bloqueado');
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  if (url.pathname === '/api/campaigns' && scenario === 'loading') return new Promise(() => {});
  let data = baseData[url.pathname] ?? [];
  let status = 200;
  if (url.pathname === '/api/campaigns' && scenario === 'error') { data = { error: 'Falha local de demonstração' }; status = 500; }
  else if ((init.method || 'GET') !== 'GET') { data = { error: 'Revisão visual: nenhuma alteração é enviada.' }; status = 403; }
  else if (/^\/api\/conversations\/[^/]+\/messages$/.test(url.pathname)) data = messages;
  else if (url.pathname.endsWith('/ai-suggestion')) data = { suggestion: null };
  else if (url.pathname === '/api/conversations/mine/closed' || url.pathname.includes('/closed-today')) data = { items: [], total: 0 };
  else if (url.pathname === '/api/metrics') data = { scope: 'admin', period: 'today', byAgent: [{ agentId: 'review-agent', agentName: 'Lucas Silva', closedCount: 24, avgResolutionMinutes: 18, avgFirstResponseMinutes: 3 }, { agentId: 'review-agent-2', agentName: 'Mariana Costa', closedCount: 16, avgResolutionMinutes: 22, avgFirstResponseMinutes: 4 }], bySector: [{ sectorId: 'sector-1', sectorName: 'Financeiro', closedCount: 23 }, { sectorId: 'sector-2', sectorName: 'Suporte Técnico', closedCount: 17 }], byReason: [{ reasonId: 'reason-1', reasonName: 'Resolvido', closedCount: 31 }] };
  else if (url.pathname === '/api/admin/channels/channel-1') data = channels[0];
  else if (url.pathname === '/api/campaigns/review') data = { id: 'review', name: 'Campanha de revisão', status: 'completed', channelId: 'channel-1', sentCount: 1, failedCount: 1, skippedCount: 1, totalRecipients: 3, recipients: [{ id: 'r1', displayName: 'Ana Beatriz', phoneNumber: '+55 11 98765-4321', status: 'sent' }, { id: 'r2', displayName: 'Mariana Costa', phoneNumber: '+55 11 98765-4322', status: 'failed', errorMessage: 'Falha no envio' }, { id: 'r3', displayName: 'Carlos Lima', phoneNumber: '+55 11 98765-4323', status: 'skipped' }] };
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
};

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <AuthProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/campanhas" element={<CampaignsPage />} />
          <Route path="/campanhas/:id" element={<CampaignDetailPage />} />
        </Route>
        <Route element={<AppShell dense />}>
          <Route path="/relatorios" element={<ReportsPage />} />
          <Route path="/supervisao" element={<SupervisionPage />} />
          <Route path="/configuracoes" element={<SettingsLayout />}>
            <Route index element={<SettingsIndex />} />
            <Route path="canais" element={<ChannelsListPage />} />
            <Route path="canais/:id" element={<ChannelDetailPage />}>
              <Route index element={<Navigate to="conexao" replace />} />
              <Route path="conexao" element={<ChannelConnectionTab />} />
              <Route path="atendimento" element={<ChannelBehaviorTab />} />
            </Route>
            <Route path="equipe" element={<TeamLayout />}>
              <Route index element={<Navigate to="usuarios" replace />} />
              <Route path="usuarios" element={<UsersPage />} />
              <Route path="setores" element={<SectorsPage />} />
              <Route path="perfis" element={<RolesPage />} />
            </Route>
            <Route path="cadastros" element={<RegistersLayout />}>
              <Route index element={<Navigate to="motivos" replace />} />
              <Route path="motivos" element={<ReasonsPage />} />
              <Route path="cidades" element={<CitiesPage />} />
            </Route>
            <Route path="empresa" element={<CompanyPage />} />
            <Route path="mensagens" element={<MessagesLayout />}>
              <Route index element={<Navigate to="boas-vindas" replace />} />
              <Route path="boas-vindas" element={<WelcomePage />} />
              <Route path="abertura-encerramento" element={<AssignmentPage />} />
              <Route path="avisos-cidade" element={<CityNoticesPage />} />
              <Route path="respostas-rapidas" element={<QuickRepliesPage />} />
              <Route path="templates" element={<TemplatesPage />} />
            </Route>
            <Route path="regras/horario" element={<BusinessHoursPage />} />
            <Route path="automacao/triagem-menu" element={<MenuTriagePage />} />
            <Route path="automacao/ia" element={<AiTriagePage />} />
            <Route path="automacao/identificacao" element={<IdentificationPage />} />
            <Route path="automacao/transcricao" element={<TranscriptionPage />} />
            <Route path="automacao/noturno" element={<NightModePage />} />
            <Route path="automacao/ferramentas" element={<AiToolsPage />} />
            <Route path="integracoes" element={<IntegrationsLayout />}>
              <Route index element={<Navigate to="sgp/consultas" replace />} />
              <Route path="sgp" element={<SgpIntegrationLayout />}>
                <Route index element={<Navigate to="consultas" replace />} />
                <Route path="consultas" element={<SgpQueryPage />} />
                <Route path="envios" element={<SgpChannelPage />} />
              </Route>
              <Route path="openai" element={<OpenAiPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  </HashRouter>,
);
