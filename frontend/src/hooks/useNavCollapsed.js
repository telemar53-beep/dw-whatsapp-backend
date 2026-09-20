import { useState } from 'react';

function read(key, fallback) {
  try { const saved = localStorage.getItem(key); return saved === null ? fallback : saved === '1'; }
  catch { return fallback; }
}

// Independent visual preferences keep the chat compact without narrowing administration.
export function useNavCollapsed({ context = 'general', defaultCollapsed = false } = {}) {
  const key = context === 'general' ? 'dw_nav_collapsed' : `dw_nav_collapsed_${context}`;
  const [preferences, setPreferences] = useState({});
  const collapsed = preferences[key] ?? read(key, defaultCollapsed);
  function toggle() {
    const next = !collapsed;
    try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* visual preference remains in memory */ }
    setPreferences(previous => ({ ...previous, [key]: next }));
  }
  return { collapsed, toggle };
}
