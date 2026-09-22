import { useAuth } from '../contexts/AuthContext';
import { listPlansForAdmin } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

// A tela de administração precisa ver também os planos inativos e a observação
// interna, então usa a consulta administrativa. A consulta operacional
// (/api/plans) é outra coisa e não passa por aqui.
export function usePlans() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () => listPlansForAdmin(token),
    [token],
    { initial: [], enabled: Boolean(token) }
  );
  return { plans: data, status, error, loading: status === 'loading', refresh };
}
