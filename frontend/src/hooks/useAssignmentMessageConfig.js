import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAssignmentMessageConfig } from '../services/api';

const EMPTY_CONFIG = { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] };

export function useAssignmentMessageConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getAssignmentMessageConfig(token)
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
