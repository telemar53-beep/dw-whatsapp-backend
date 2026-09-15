import { useAuth } from '../contexts/AuthContext';
import { listChannels } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useChannels(enabled = true, includeHidden = false) {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () => listChannels(token, { includeHidden }),
    [token, includeHidden],
    { initial: [], enabled: Boolean(token) && enabled }
  );
  return { channels: data, status, error, loading: status === 'loading', refresh };
}
