import { useAuth } from '../contexts/AuthContext';
import { getAiConfig } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

const EMPTY_CONFIG = { configured: false, mode: 'disabled', model: '' };

export function useAiConfig() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => getAiConfig(token), [token], { initial: EMPTY_CONFIG, enabled: Boolean(token) });
  return { config: data, status, error, loading: status === 'loading', refresh };
}
