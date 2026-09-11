import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyClosedConversations } from '../services/api';

const PAGE_SIZE = 20;

export function useMyClosedConversations() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getMyClosedConversations({ offset: 0, limit: PAGE_SIZE }, token)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token]);

  const loadMore = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return getMyClosedConversations({ offset: items.length, limit: PAGE_SIZE }, token)
      .then((data) => {
        setItems((prev) => [...prev, ...data.items]);
        setHasMore(data.hasMore);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [token, items.length]);

  useEffect(() => {
    refresh();
    // Only ever refetch from the start when the token itself changes, not on every
    // items-length change loadMore already causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return { items, hasMore, loading, loadMore, refresh };
}
