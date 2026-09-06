import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listAgentsAdmin } from '../services/api';

export function useAgentsAdmin(enabled = true) {
  const { token } = useAuth();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(() => {
    if (!token || !enabled) return Promise.resolve();
    setLoading(true);
    return listAgentsAdmin(token)
      .then((data) => {
        setAgents(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}
