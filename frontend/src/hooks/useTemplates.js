import { useAuth } from '../contexts/AuthContext';
import { listTemplatesAdmin } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useTemplates() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listTemplatesAdmin(token), [token], { initial: [], enabled: Boolean(token) });
  return { templates: data, status, error, loading: status === 'loading', refresh };
}
