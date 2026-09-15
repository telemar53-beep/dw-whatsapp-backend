import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { applyContactAvatarUpdate } from '../utils/contactAvatar';
import { getQueue } from '../services/api';

export function useQueue() {
  const { token } = useAuth();
  const socket = useSocket();
  const [queue, setQueue] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!token) return;
    setStatus('loading');
    getQueue(token)
      .then((data) => {
        setQueue(data);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus(err && err.status === 403 ? 'forbidden' : 'error');
      });
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

    function onAvatarUpdated(payload) {
      setQueue((prev) => applyContactAvatarUpdate(prev, payload));
    }

    socket.on('queue:new', onNew);
    socket.on('queue:removed', onRemoved);
    socket.on('contact:avatar-updated', onAvatarUpdated);
    return () => {
      socket.off('queue:new', onNew);
      socket.off('queue:removed', onRemoved);
      socket.off('contact:avatar-updated', onAvatarUpdated);
    };
  }, [socket]);

  return { queue, status, loading: status === 'loading' };
}
