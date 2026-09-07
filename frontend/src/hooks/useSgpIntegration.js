import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSgpIntegration } from '../services/api';

export function useSgpIntegration() {
  const { token } = useAuth();
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getSgpIntegration(token)
      .then((data) => {
        setIntegration(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { integration, loading, refresh };
}
