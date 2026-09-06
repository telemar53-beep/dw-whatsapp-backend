import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

export function usePresence(agents) {
  const socket = useSocket();
  const { agent } = useAuth();
  const [onlineIds, setOnlineIds] = useState(() => new Set());

  useEffect(() => {
    const seeded = new Set(agents.filter((a) => a.online).map((a) => a.id));
    // The server never broadcasts a socket's own presence:online event back to
    // itself (see socket-server.js), so the initial snapshot can race and miss
    // the current agent — always assume the viewer is online.
    if (agent) {
      seeded.add(agent.id);
    }
    setOnlineIds(seeded);
  }, [agents, agent]);

  useEffect(() => {
    if (!socket) return undefined;

    function onOnline({ agentId }) {
      setOnlineIds((prev) => new Set(prev).add(agentId));
    }

    function onOffline({ agentId }) {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }

    socket.on('presence:online', onOnline);
    socket.on('presence:offline', onOffline);
    return () => {
      socket.off('presence:online', onOnline);
      socket.off('presence:offline', onOffline);
    };
  }, [socket]);

  return onlineIds;
}
