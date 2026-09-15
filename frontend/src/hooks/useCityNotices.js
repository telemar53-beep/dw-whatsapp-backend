import { useAuth } from '../contexts/AuthContext';
import { listCityNotices } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useCityNotices() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listCityNotices(token), [token], { initial: [], enabled: Boolean(token) });
  return { cityNotices: data, status, error, loading: status === 'loading', refresh };
}
