import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getMyConversations } from '../services/api';

export function useMyConversations() {
  const { token } = useAuth();
  const socket = useSocket();
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    if (!token) return;
    getMyConversations(token).then(setConversations).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!socket) return undefined;

    function onAssigned({ conversation }) {
      setConversations((prev) => {
        const index = prev.findIndex((c) => c.id === conversation.id);
        if (index === -1) return [...prev, conversation];
        const next = [...prev];
        next[index] = conversation;
        return next;
      });
    }

    function onRemoved({ conversationId }) {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    }

    socket.on('conversation:assigned', onAssigned);
    socket.on('conversation:removed', onRemoved);
    socket.on('conversation:closed', onRemoved);
    return () => {
      socket.off('conversation:assigned', onAssigned);
      socket.off('conversation:removed', onRemoved);
      socket.off('conversation:closed', onRemoved);
    };
  }, [socket]);

  return conversations;
}
