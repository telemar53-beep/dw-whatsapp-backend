import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listQuickReplies } from '../services/api';

export function useQuickReplies() {
  const { token } = useAuth();
  const [quickReplies, setQuickReplies] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listQuickReplies(token)
      .then((data) => {
        setQuickReplies(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { quickReplies, loading, refresh };
}
