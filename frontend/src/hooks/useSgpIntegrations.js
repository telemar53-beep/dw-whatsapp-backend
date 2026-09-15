import { useAuth } from '../contexts/AuthContext';
import { listSgpIntegrations } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useSgpIntegrations() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listSgpIntegrations(token), [token], { initial: [], enabled: Boolean(token) });
  return { integrations: data, status, error, loading: status === 'loading', refresh };
}
