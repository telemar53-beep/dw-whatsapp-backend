import { useAuth } from '../contexts/AuthContext';
import { listQuickReplies } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useQuickReplies() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listQuickReplies(token), [token], { initial: [], enabled: Boolean(token) });
  return { quickReplies: data, status, error, loading: status === 'loading', refresh };
}
