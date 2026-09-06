import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { listAgents } from '../services/api';

function seedOnlineIds(agents, agent) {
  const seeded = new Set(agents.filter((a) => a.online).map((a) => a.id));
  // The server never broadcasts a socket's own presence:online event back to
  // itself (see socket-server.js), so any snapshot can race and miss the
  // current agent — always assume the viewer is online.
  if (agent) {
    seeded.add(agent.id);
  }
  return seeded;
}

export function usePresence(agents) {
  const socket = useSocket();
  const { agent, token } = useAuth();
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const hasConnectedBefore = useRef(false);

  useEffect(() => {
    setOnlineIds(seedOnlineIds(agents, agent));
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

    function onConnect() {
      // The socket's own 'connect' event fires on the very first connection
      // too — skip that one (useAgents()'s mount fetch already covers it) and
      // only re-fetch on a real reconnect, where events from the disconnect
      // window would otherwise be lost forever.
      if (!hasConnectedBefore.current) {
        hasConnectedBefore.current = true;
        return;
      }
      if (!token) return;
      listAgents(token)
        .then((freshAgents) => setOnlineIds(seedOnlineIds(freshAgents, agent)))
        .catch(() => {});
    }

    socket.on('presence:online', onOnline);
    socket.on('presence:offline', onOffline);
    socket.on('connect', onConnect);
    return () => {
      socket.off('presence:online', onOnline);
      socket.off('presence:offline', onOffline);
      socket.off('connect', onConnect);
    };
  }, [socket, token, agent]);

  return onlineIds;
}
