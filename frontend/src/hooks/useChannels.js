import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listChannels } from '../services/api';

export function useChannels(enabled = true) {
  const { token } = useAuth();
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(() => {
    if (!token || !enabled) return Promise.resolve();
    setLoading(true);
    return listChannels(token)
      .then((data) => {
        setChannels(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { channels, loading, refresh };
}
