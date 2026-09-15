import { useAuth } from '../contexts/AuthContext';
import { getAssignmentMessageConfig } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

const EMPTY_CONFIG = { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] };

export function useAssignmentMessageConfig() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => getAssignmentMessageConfig(token), [token], { initial: EMPTY_CONFIG, enabled: Boolean(token) });
  return { config: data, status, error, loading: status === 'loading', refresh };
}
