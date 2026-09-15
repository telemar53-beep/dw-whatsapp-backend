import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasLevel } from '../navigation/navItems';
import AccessDeniedPage from '../pages/AccessDeniedPage';

// `requireAdmin` é o nome antigo; vale como level="admin" até todos os usos
// migrarem para `level`.
function ProtectedRoute({ children, level, requireAdmin = false, areaLabel }) {
  const { token, agent } = useAuth();
  const effectiveLevel = level || (requireAdmin ? 'admin' : 'auth');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (!hasLevel(agent, effectiveLevel)) {
    return <AccessDeniedPage areaLabel={areaLabel} level={effectiveLevel} />;
  }
  return children;
}

export default ProtectedRoute;
