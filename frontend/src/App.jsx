import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
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
import SgpQueryPage from './pages/settings/integrations/SgpQueryPage';
import SgpChannelPage from './pages/settings/integrations/SgpChannelPage';
import OpenAiPage from './pages/settings/integrations/OpenAiPage';
import MenuTriagePage from './pages/settings/automation/MenuTriagePage';
import AiTriagePage from './pages/settings/automation/AiTriagePage';
import IdentificationPage from './pages/settings/automation/IdentificationPage';
import TranscriptionPage from './pages/settings/automation/TranscriptionPage';
import NightModePage from './pages/settings/automation/NightModePage';
import AiToolsPage from './pages/settings/automation/AiToolsPage';
import { LEGACY_REDIRECTS } from './navigation/navItems';

// Rota antiga → nova, trocando :params e mantendo ?query.
function LegacyRedirect({ to }) {
  const params = useParams();
  const location = useLocation();
  const target = to.replace(/:([A-Za-z]+)/g, (_, key) => params[key] || '');
  return <Navigate to={`${target}${location.search}`} replace />;
}

function Shell({ dense = false }) {
  return (
    <ProtectedRoute level="auth">
      <AppShell dense={dense} />
    </ProtectedRoute>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<Shell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/campanhas" element={<CampaignsPage />} />
              <Route path="/campanhas/:id" element={<CampaignDetailPage />} />
            </Route>

            <Route element={<Shell dense />}>
              <Route path="/relatorios" element={<ReportsPage />} />
              <Route
                path="/supervisao"
                element={
                  <ProtectedRoute level="admin" areaLabel="Supervisão">
                    <SupervisionPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes"
                element={
                  <ProtectedRoute level="admin" areaLabel="Configurações">
                    <SettingsLayout />
                  </ProtectedRoute>
                }
              >
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
                <Route path="cadastros/motivos" element={<ReasonsPage />} />
                <Route path="cadastros/cidades" element={<CitiesPage />} />
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
                <Route path="integracoes/sgp-consulta" element={<SgpQueryPage />} />
                <Route path="integracoes/sgp-canal" element={<SgpChannelPage />} />
                <Route path="integracoes/openai" element={<OpenAiPage />} />
              </Route>
            </Route>

            {LEGACY_REDIRECTS.map((r) => (
              <Route key={r.from} path={r.from} element={<LegacyRedirect to={r.to} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
