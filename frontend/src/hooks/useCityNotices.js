import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listCityNotices } from '../services/api';

export function useCityNotices() {
  const { token } = useAuth();
  const [cityNotices, setCityNotices] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return listCityNotices(token)
      .then((data) => {
        setCityNotices(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cityNotices, loading, refresh };
}
