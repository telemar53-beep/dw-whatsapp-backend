import { useState, useEffect, useCallback, useRef } from 'react';
import { descreverErro } from '../utils/errorMessages';

// Um padrão só de carregamento para hooks de lista e de configuração:
// status separa "ainda não sei" de "não existe" de "deu erro" de "não posso".
export function useAsyncResource(fetcher, deps, { initial = null, enabled = true } = {}) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState(enabled ? 'loading' : 'ready');
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState(null);
  const hasData = useRef(false);

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve();
    if (hasData.current) setReloading(true);
    else setStatus('loading');
    setError(null);
    return fetcher()
      .then((result) => {
        hasData.current = true;
        setData(result);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus(err && err.status === 403 ? 'forbidden' : 'error');
        setError(descreverErro(err, (err && err.message) || null));
      })
      .finally(() => setReloading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, status, error, reloading, refresh, setData };
}
