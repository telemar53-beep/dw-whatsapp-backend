import { useState, useCallback } from 'react';

const KEY = 'dw_nav_collapsed';

function read() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* sem storage: só não persiste */ }
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
