import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getMessages, sendMessage as apiSendMessage } from '../services/api';

export function useConversationMessages(conversationId) {
  const { token } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setMessages([]);
    if (!conversationId || !token) return;
    getMessages(conversationId, token).then(setMessages).catch(() => {});
  }, [conversationId, token]);

  useEffect(() => {
    if (!socket || !conversationId) return undefined;

    function onNew({ conversation, message }) {
      if (conversation.id !== conversationId) return;
      setMessages((prev) => [...prev, message]);
    }

    function onUpdated({ conversationId: updatedId, message }) {
      if (updatedId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    }

    socket.on('message:new', onNew);
    socket.on('message:updated', onUpdated);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:updated', onUpdated);
    };
  }, [socket, conversationId]);

  const sendMessage = useCallback(
    async (content, file) => {
      const created = await apiSendMessage(conversationId, content, token, file);
      setMessages((prev) => [...prev, created]);
      return created;
    },
    [conversationId, token]
  );

  return { messages, sendMessage };
}
