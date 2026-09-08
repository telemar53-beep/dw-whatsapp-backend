import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useNotificationSound } from './useNotificationSound';

export function useUnreadMyConversations(myConversations, selectedConversationId) {
  const socket = useSocket();
  const { muted, playChime } = useNotificationSound();
  const [unreadIds, setUnreadIds] = useState(() => new Set());

  useEffect(() => {
    if (!socket) return undefined;

    function onNew({ conversation, message }) {
      if (message.direction !== 'inbound') return;
      if (conversation.id === selectedConversationId) return;
      if (!myConversations.some((c) => c.id === conversation.id)) return;
      setUnreadIds((prev) => new Set(prev).add(conversation.id));
      if (!muted) playChime();
    }

    socket.on('message:new', onNew);
    return () => {
      socket.off('message:new', onNew);
    };
  }, [socket, selectedConversationId, myConversations, muted, playChime]);

  useEffect(() => {
    setUnreadIds((prev) => {
      const stillPresent = new Set(myConversations.map((c) => c.id));
      const next = new Set([...prev].filter((id) => stillPresent.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [myConversations]);

  const clearUnread = useCallback((conversationId) => {
    setUnreadIds((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  return { unreadIds, clearUnread };
}
