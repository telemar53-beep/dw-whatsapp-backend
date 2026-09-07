import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listTemplatesAdmin } from '../services/api';

export function useTemplates() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await listTemplatesAdmin(token);
    setTemplates(data);
  }, [token]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return { templates, loading, refresh };
}
