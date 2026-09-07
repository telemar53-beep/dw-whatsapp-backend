import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getTriage } from '../services/api';

export function useTriage() {
  const { token } = useAuth();
  const [config, setConfig] = useState(null);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getTriage(token)
      .then((data) => {
        setConfig({ questionText: data.questionText, confirmationText: data.confirmationText, maxAttempts: data.maxAttempts });
        setOptions(data.options);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, options, loading, refresh };
}
