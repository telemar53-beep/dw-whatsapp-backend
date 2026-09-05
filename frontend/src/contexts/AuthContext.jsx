import { createContext, useContext, useState, useCallback } from 'react';
import { login as apiLogin } from '../services/api';

const AuthContext = createContext(null);

function readStoredAgent() {
  const stored = localStorage.getItem('dw_agent');
  return stored ? JSON.parse(stored) : null;
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

  const logout = useCallback(() => {
    localStorage.removeItem('dw_token');
    localStorage.removeItem('dw_agent');
    setToken(null);
    setAgent(null);
  }, []);

  return <AuthContext.Provider value={{ token, agent, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
