import { useAuth } from '../contexts/AuthContext';
import { listChannelsForAgent } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

// Igual a useChannels, mas para telas que qualquer atendente acessa (não só
// admin/gerente): usa GET /api/channels em vez do endpoint /api/admin/channels.
export function useAgentChannels() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () => listChannelsForAgent(token),
    [token],
    { initial: [], enabled: Boolean(token) }
  );
  return { channels: data, status, error, loading: status === 'loading', refresh };
}
