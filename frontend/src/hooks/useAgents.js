import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listAgents } from '../services/api';

export function useAgents() {
  const { token } = useAuth();
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    if (!token) return;
    listAgents(token).then(setAgents).catch(() => {});
  }, [token]);

  return agents;
}
