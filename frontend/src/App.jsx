import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminChannelsPage from './pages/AdminChannelsPage';
import MetricsPage from './pages/MetricsPage';
import SupervisionPage from './pages/SupervisionPage';
import CampaignsPage from './pages/CampaignsPage';
import CampaignDetailPage from './pages/CampaignDetailPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import SettingsIndex from './pages/settings/SettingsIndex';
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
              <Route path="/relatorios" element={<MetricsPage />} />
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
                {/* Provisório até as Tasks 13–18: tudo cai na página antiga. */}
                <Route path="*" element={<AdminChannelsPage />} />
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
