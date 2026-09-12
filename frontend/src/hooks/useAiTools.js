import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listAiTools } from '../services/api';

export function useAiTools() {
  const { token } = useAuth();
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listAiTools(token)
      .then((data) => { setTools(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  return { tools, loading, refresh };
}
