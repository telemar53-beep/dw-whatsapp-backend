import { useAuth } from '../contexts/AuthContext';
import { getCompanyConfig } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

const EMPTY_CONFIG = { id: null, name: '', acceptedPayeeNames: [] };

export function useCompanyConfig() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => getCompanyConfig(token), [token], { initial: EMPTY_CONFIG, enabled: Boolean(token) });
  return { config: data, status, error, loading: status === 'loading', refresh };
}
