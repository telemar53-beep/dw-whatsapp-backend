import { useAuth } from '../contexts/AuthContext';
import { getSgpQueryConfig } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

const EMPTY = { configured: false };

export function useSgpQueryConfig() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => getSgpQueryConfig(token), [token], { initial: EMPTY, enabled: Boolean(token) });
  return { config: data, status, error, loading: status === 'loading', refresh };
}
