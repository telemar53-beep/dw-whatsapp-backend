import { useAuth } from '../contexts/AuthContext';
import { listSectors } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useSectors() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listSectors(token), [token], { initial: [], enabled: Boolean(token) });
  return { sectors: data, status, error, loading: status === 'loading', refresh };
}
