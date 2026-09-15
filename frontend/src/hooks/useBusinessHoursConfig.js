import { useAuth } from '../contexts/AuthContext';
import { getBusinessHoursConfig } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

const EMPTY_CONFIG = { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' };

export function useBusinessHoursConfig() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => getBusinessHoursConfig(token), [token], { initial: EMPTY_CONFIG, enabled: Boolean(token) });
  return { config: data, status, error, loading: status === 'loading', refresh };
}
