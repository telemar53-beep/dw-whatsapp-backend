import { useAuth } from '../contexts/AuthContext';
import { listAiTools } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useAiTools() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listAiTools(token), [token], { initial: [], enabled: Boolean(token) });
  return { tools: data, status, error, loading: status === 'loading', refresh };
}
