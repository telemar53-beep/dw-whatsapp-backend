import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getQueue } from '../services/api';

export function useQueue() {
  const { token } = useAuth();
  const socket = useSocket();
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!token) return;
    getQueue(token).then(setQueue).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!socket) return undefined;

    function onNew({ conversation }) {
      setQueue((prev) => {
        const index = prev.findIndex((c) => c.id === conversation.id);
        if (index === -1) return [...prev, conversation];
        const next = [...prev];
        next[index] = conversation;
        return next;
      });
    }

    function onRemoved({ conversationId }) {
      setQueue((prev) => prev.filter((c) => c.id !== conversationId));
    }

    socket.on('queue:new', onNew);
    socket.on('queue:removed', onRemoved);
    return () => {
      socket.off('queue:new', onNew);
      socket.off('queue:removed', onRemoved);
    };
  }, [socket]);

  return queue;
}
