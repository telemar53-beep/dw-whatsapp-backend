import { useAuth } from '../contexts/AuthContext';
import { listCities } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useCities() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listCities(token), [token], { initial: [], enabled: Boolean(token) });
  return { cities: data, status, error, loading: status === 'loading', refresh };
}
