import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listReasonsAdmin } from '../services/api';

export function useReasonsAdmin() {
  const { token } = useAuth();
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listReasonsAdmin(token)
      .then((data) => {
        setReasons(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { reasons, loading, refresh };
}
