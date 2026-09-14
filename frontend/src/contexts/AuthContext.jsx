import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { login as apiLogin, setUnauthorizedHandler } from '../services/api';

const AuthContext = createContext(null);

function readStoredAgent() {
  const stored = localStorage.getItem('dw_agent');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('dw_token'));
  const [agent, setAgent] = useState(readStoredAgent);

  const login = useCallback(async (email, password) => {
    const result = await apiLogin(email, password);
    localStorage.setItem('dw_token', result.token);
    localStorage.setItem('dw_agent', JSON.stringify(result.agent));
    setToken(result.token);
    setAgent(result.agent);
    return result;
  }, []);

  // O perfil muda sem relogar (nome e foto em "Meu perfil"): o que está na tela
  // precisa acompanhar, e o que está guardado também.
  const updateAgent = useCallback((partial) => {
    setAgent((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      localStorage.setItem('dw_agent', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('dw_token');
    localStorage.removeItem('dw_agent');
    setToken(null);
    setAgent(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, agent, login, logout, updateAgent }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
