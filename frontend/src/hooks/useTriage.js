import { useAuth } from '../contexts/AuthContext';
import { getTriage } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

const EMPTY = { config: null, options: [] };

export function useTriage() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(
    () =>
      getTriage(token).then((result) => ({
        config: { questionText: result.questionText, confirmationText: result.confirmationText, maxAttempts: result.maxAttempts },
        options: result.options,
      })),
    [token],
    { initial: EMPTY, enabled: Boolean(token) }
  );
  return { config: data.config, options: data.options, status, error, loading: status === 'loading', refresh };
}
