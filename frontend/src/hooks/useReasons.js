import { useAuth } from '../contexts/AuthContext';
import { listReasons } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useReasons() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listReasons(token), [token], { initial: [], enabled: Boolean(token) });
  return { reasons: data, status, error, loading: status === 'loading', refresh };
}
