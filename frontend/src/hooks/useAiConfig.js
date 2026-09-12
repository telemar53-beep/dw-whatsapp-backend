import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAiConfig } from '../services/api';

export function useAiConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState({ configured: false, mode: 'disabled', model: '' });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getAiConfig(token)
      .then((data) => { setConfig(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  return { config, loading, refresh };
}
