import { useAuth } from '../contexts/AuthContext';
import { listAgents } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useAgents() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listAgents(token), [token], { initial: [], enabled: Boolean(token) });
  return { agents: data, status, error, loading: status === 'loading', refresh };
}
