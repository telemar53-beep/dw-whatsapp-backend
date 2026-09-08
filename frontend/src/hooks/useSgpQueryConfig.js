import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSgpQueryConfig } from '../services/api';

export function useSgpQueryConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState({ configured: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getSgpQueryConfig(token)
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, loading, refresh };
}
