import { useAuth } from '../contexts/AuthContext';
import { listAgentsAdmin } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useAgentsAdmin(enabled = true) {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () => listAgentsAdmin(token),
    [token],
    { initial: [], enabled: Boolean(token) && enabled }
  );
  return { agents: data, status, error, loading: status === 'loading', refresh };
}
