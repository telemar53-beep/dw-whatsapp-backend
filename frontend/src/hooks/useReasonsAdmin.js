import { useAuth } from '../contexts/AuthContext';
import { listReasonsAdmin } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useReasonsAdmin() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listReasonsAdmin(token), [token], { initial: [], enabled: Boolean(token) });
  return { reasons: data, status, error, loading: status === 'loading', refresh };
}
