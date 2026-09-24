import { lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useTituloDaAba } from './hooks/useTituloDaAba';
import { SocketProvider } from './contexts/SocketContext';
import { AgentsProvider } from './contexts/AgentsContext';
import { CompanyProvider } from './contexts/CompanyContext';
import { MediaTokenProvider } from './contexts/MediaTokenContext';
import ProtectedRoute from './components/ProtectedRoute';
import RotaLazy from './components/RotaLazy';
import LoginPage from './pages/LoginPage';
import { LEGACY_REDIRECTS } from './navigation/navItems';

// LoginPage fica ESTÁTICA de propósito, e é a única. Ela é a primeira tela de
// quem chega, e torná-la sob demanda acrescentaria uma ida à rede justamente
// antes do login — trocaria bytes por espera no pior momento. Ela é pequena:
// react, react-router, o contexto de autenticação e dois utilitários.
//
// Todo o resto é área autenticada e sai do carregamento inicial. Quem abre o
// sistema não baixa mais a mesa de atendimento, Configurações, Relatórios,
// Supervisão nem Campanhas para ver um formulário de e-mail e senha.
const AppShell = lazy(() => import('./components/AppShell'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SupervisionPage = lazy(() => import('./pages/SupervisionPage'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage'));
const CampaignDetailPage = lazy(() => import('./pages/CampaignDetailPage'));
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'));
const SettingsIndex = lazy(() => import('./pages/settings/SettingsIndex'));
const ChannelsListPage = lazy(() => import('./pages/settings/channels/ChannelsListPage'));
const ChannelDetailPage = lazy(() => import('./pages/settings/channels/ChannelDetailPage'));
const ChannelConnectionTab = lazy(() => import('./pages/settings/channels/ChannelConnectionTab'));
const ChannelBehaviorTab = lazy(() => import('./pages/settings/channels/ChannelBehaviorTab'));
const TeamLayout = lazy(() => import('./pages/settings/team/TeamLayout'));
const UsersPage = lazy(() => import('./pages/settings/team/UsersPage'));
const SectorsPage = lazy(() => import('./pages/settings/team/SectorsPage'));
const RolesPage = lazy(() => import('./pages/settings/team/RolesPage'));
const RegistersLayout = lazy(() => import('./pages/settings/registers/RegistersLayout'));
const ReasonsPage = lazy(() => import('./pages/settings/registers/ReasonsPage'));
const CitiesPage = lazy(() => import('./pages/settings/registers/CitiesPage'));
const PlansPage = lazy(() => import('./pages/settings/registers/PlansPage'));
const CompanyPage = lazy(() => import('./pages/settings/CompanyPage'));
const MessagesLayout = lazy(() => import('./pages/settings/messages/MessagesLayout'));
const WelcomePage = lazy(() => import('./pages/settings/messages/WelcomePage'));
const CityNoticesPage = lazy(() => import('./pages/settings/messages/CityNoticesPage'));
const QuickRepliesPage = lazy(() => import('./pages/settings/messages/QuickRepliesPage'));
const TemplatesPage = lazy(() => import('./pages/settings/messages/TemplatesPage'));
const AssignmentPage = lazy(() => import('./pages/settings/rules/AssignmentPage'));
const BusinessHoursPage = lazy(() => import('./pages/settings/rules/BusinessHoursPage'));
const IntegrationsLayout = lazy(() => import('./pages/settings/integrations/IntegrationsLayout'));
const SgpIntegrationLayout = lazy(() => import('./pages/settings/integrations/SgpIntegrationLayout'));
const SgpQueryPage = lazy(() => import('./pages/settings/integrations/SgpQueryPage'));
const SgpChannelPage = lazy(() => import('./pages/settings/integrations/SgpChannelPage'));
const OpenAiPage = lazy(() => import('./pages/settings/integrations/OpenAiPage'));
const MenuTriagePage = lazy(() => import('./pages/settings/automation/MenuTriagePage'));
const AiTriagePage = lazy(() => import('./pages/settings/automation/AiTriagePage'));
const IdentificationPage = lazy(() => import('./pages/settings/automation/IdentificationPage'));
const TranscriptionPage = lazy(() => import('./pages/settings/automation/TranscriptionPage'));
const NightModePage = lazy(() => import('./pages/settings/automation/NightModePage'));
const AiToolsPage = lazy(() => import('./pages/settings/automation/AiToolsPage'));

// Cada elemento de rota entra embrulhado, e não um Suspense só lá em cima: o
// Suspense que vale é o MAIS PRÓXIMO, então o esqueleto aparece no lugar do
// conteúdo e o que está em volta — menu lateral, abas de Configurações —
// continua na tela durante a troca. Um Suspense único na raiz apagaria a
// navegação inteira a cada clique.
function lazyEl(Componente) {
  return (
    <RotaLazy>
      <Componente />
    </RotaLazy>
  );
}

// Rota antiga → nova, trocando :params e mantendo ?query.
function LegacyRedirect({ to }) {
  const params = useParams();
  const location = useLocation();
  const target = to.replace(/:([A-Za-z]+)/g, (_, key) => params[key] || '');
  return <Navigate to={`${target}${location.search}`} replace />;
}

// O ProtectedRoute continua ESTÁTICO e por FORA do RotaLazy de propósito: a
// checagem de permissão acontece antes de o trecho ser pedido, então quem não
// pode ver a área também não baixa o código dela.
function Shell({ dense = false }) {
  return (
    <ProtectedRoute level="auth">
      <RotaLazy>
        <AppShell dense={dense} />
      </RotaLazy>
    </ProtectedRoute>
  );
}

// Fica dentro do Router só para poder viver em um componente; o título não
// depende de rota, só do nome da empresa.
function TituloDaAba() {
  useTituloDaAba();
  return null;
}

function App() {
  return (
    <BrowserRouter>
      {/* Fora do AuthProvider porque a rota e publica: nao depende de token, e
          e a primeira coisa de que a tela de entrada precisa. Uma copia so
          para a sessao — antes, o TituloDaAba e a LoginPage buscavam cada um
          o seu, e eram duas requisicoes com dois preflights no login. */}
      <CompanyProvider>
      <AuthProvider>
        {/* Dentro do AuthProvider porque precisa do JWT da sessão para pedir o
            token de mídia; fora do SocketProvider porque não depende dele — a
            emissão é uma chamada HTTP a cada 25 minutos, não um evento. */}
        <MediaTokenProvider>
        <SocketProvider>
          {/* Uma cópia só da lista de atendentes para a sessão. Não busca nada
              enquanto nenhum useAgents() estiver montado. */}
          <AgentsProvider>
          <TituloDaAba />
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<Shell />}>
              <Route path="/" element={lazyEl(DashboardPage)} />
              <Route
                path="/campanhas"
                element={
                  <ProtectedRoute level="admin" areaLabel="Campanhas">
                    {lazyEl(CampaignsPage)}
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campanhas/:id"
                element={
                  <ProtectedRoute level="admin" areaLabel="Campanhas">
                    {lazyEl(CampaignDetailPage)}
                  </ProtectedRoute>
                }
              />
            </Route>

            <Route element={<Shell dense />}>
              <Route path="/relatorios" element={lazyEl(ReportsPage)} />
              <Route
                path="/supervisao"
                element={
                  <ProtectedRoute level="admin" areaLabel="Supervisão">
                    {lazyEl(SupervisionPage)}
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes"
                element={
                  <ProtectedRoute level="admin" areaLabel="Configurações">
                    {lazyEl(SettingsLayout)}
                  </ProtectedRoute>
                }
              >
                <Route index element={lazyEl(SettingsIndex)} />
                <Route path="canais" element={lazyEl(ChannelsListPage)} />
                <Route path="canais/:id" element={lazyEl(ChannelDetailPage)}>
                  <Route index element={<Navigate to="conexao" replace />} />
                  <Route path="conexao" element={lazyEl(ChannelConnectionTab)} />
                  <Route path="atendimento" element={lazyEl(ChannelBehaviorTab)} />
                </Route>
                <Route path="equipe" element={lazyEl(TeamLayout)}>
                  <Route index element={<Navigate to="usuarios" replace />} />
                  <Route path="usuarios" element={lazyEl(UsersPage)} />
                  <Route path="setores" element={lazyEl(SectorsPage)} />
                  <Route path="perfis" element={lazyEl(RolesPage)} />
                </Route>
                <Route path="cadastros" element={lazyEl(RegistersLayout)}>
                  <Route index element={<Navigate to="motivos" replace />} />
                  <Route path="motivos" element={lazyEl(ReasonsPage)} />
                  <Route path="cidades" element={lazyEl(CitiesPage)} />
                  <Route path="planos" element={lazyEl(PlansPage)} />
                </Route>
                <Route path="empresa" element={lazyEl(CompanyPage)} />
                <Route path="mensagens" element={lazyEl(MessagesLayout)}>
                  <Route index element={<Navigate to="boas-vindas" replace />} />
                  <Route path="boas-vindas" element={lazyEl(WelcomePage)} />
                  <Route path="abertura-encerramento" element={lazyEl(AssignmentPage)} />
                  <Route path="avisos-cidade" element={lazyEl(CityNoticesPage)} />
                  <Route path="respostas-rapidas" element={lazyEl(QuickRepliesPage)} />
                  <Route path="templates" element={lazyEl(TemplatesPage)} />
                </Route>
                <Route path="regras/horario" element={lazyEl(BusinessHoursPage)} />
                <Route path="automacao/triagem-menu" element={lazyEl(MenuTriagePage)} />
                <Route path="automacao/ia" element={lazyEl(AiTriagePage)} />
                <Route path="automacao/identificacao" element={lazyEl(IdentificationPage)} />
                <Route path="automacao/transcricao" element={lazyEl(TranscriptionPage)} />
                <Route path="automacao/noturno" element={lazyEl(NightModePage)} />
                <Route path="automacao/ferramentas" element={lazyEl(AiToolsPage)} />
                <Route path="integracoes" element={lazyEl(IntegrationsLayout)}>
                  <Route index element={<Navigate to="sgp/consultas" replace />} />
                  <Route path="sgp" element={lazyEl(SgpIntegrationLayout)}>
                    <Route index element={<Navigate to="consultas" replace />} />
                    <Route path="consultas" element={lazyEl(SgpQueryPage)} />
                    <Route path="envios" element={lazyEl(SgpChannelPage)} />
                  </Route>
                  <Route path="openai" element={lazyEl(OpenAiPage)} />
                </Route>
              </Route>
            </Route>

            {LEGACY_REDIRECTS.map((r) => (
              <Route key={r.from} path={r.from} element={<LegacyRedirect to={r.to} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </AgentsProvider>
        </SocketProvider>
        </MediaTokenProvider>
      </AuthProvider>
      </CompanyProvider>
    </BrowserRouter>
  );
}

export default App;
