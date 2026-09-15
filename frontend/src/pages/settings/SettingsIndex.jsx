import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { firstAllowedSettingsPath } from '../../navigation/navItems';
import AccessDeniedPage from '../AccessDeniedPage';

function SettingsIndex() {
  const { agent } = useAuth();
  const to = firstAllowedSettingsPath(agent);
  if (!to) return <AccessDeniedPage areaLabel="Configurações" level="admin" />;
  return <Navigate to={to} replace />;
}

export default SettingsIndex;
