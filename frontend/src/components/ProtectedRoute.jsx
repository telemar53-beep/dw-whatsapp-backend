import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function ProtectedRoute({ children, requireAdmin = false }) {
  const { token, agent } = useAuth();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (requireAdmin && (!agent || agent.role !== 'admin')) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default ProtectedRoute;
