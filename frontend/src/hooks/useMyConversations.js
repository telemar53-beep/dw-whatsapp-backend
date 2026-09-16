import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { applyContactAvatarUpdate } from '../utils/contactAvatar';
import { getMyConversations } from '../services/api';

export function useMyConversations() {
  const { token } = useAuth();
  const socket = useSocket();
  const [conversations, setConversations] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!token) return;
    setStatus('loading');
    getMyConversations(token)
      .then((data) => {
        setConversations(data);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus(err && err.status === 403 ? 'forbidden' : 'error');
      });
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

    function onAvatarUpdated(payload) {
      setConversations((prev) => applyContactAvatarUpdate(prev, payload));
    }

    // Print 2026-09-16: a prévia e o horário do item só mudavam no F5. O
    // servidor manda a conversa inteira (com lastMessage*) em message:new;
    // só troca o item se a conversa já está na lista — entrar nela é papel de
    // conversation:assigned.
    function onMessageNew({ conversation }) {
      if (!conversation) return;
      setConversations((prev) => {
        const index = prev.findIndex((c) => c.id === conversation.id);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = conversation;
        return next;
      });
    }

    // message:updated é a mensagem do próprio atendente saindo (ou mudando de
    // status): traz só a mensagem, então a prévia é montada a partir dela — e
    // só se ela for mais nova que a prévia atual, para um status atrasado de
    // uma mensagem antiga não voltar a aparecer como última.
    function onMessageUpdated({ conversationId, message }) {
      if (!conversationId || !message) return;
      setConversations((prev) => prev.map((c) => {
        if (c.id !== conversationId) return c;
        if (c.lastMessageAt && message.createdAt && new Date(message.createdAt) < new Date(c.lastMessageAt)) return c;
        return {
          ...c,
          lastMessageContent: message.content,
          lastMessageType: message.messageType,
          lastMessageStatus: message.status,
          lastMessageDirection: message.direction,
          lastMessageAt: message.createdAt || c.lastMessageAt,
        };
      }));
    }

    socket.on('conversation:assigned', onAssigned);
    socket.on('conversation:removed', onRemoved);
    socket.on('conversation:closed', onRemoved);
    socket.on('contact:avatar-updated', onAvatarUpdated);
    socket.on('message:new', onMessageNew);
    socket.on('message:updated', onMessageUpdated);
    return () => {
      socket.off('conversation:assigned', onAssigned);
      socket.off('conversation:removed', onRemoved);
      socket.off('conversation:closed', onRemoved);
      socket.off('contact:avatar-updated', onAvatarUpdated);
      socket.off('message:new', onMessageNew);
      socket.off('message:updated', onMessageUpdated);
    };
  }, [socket]);

  return { conversations, status, loading: status === 'loading' };
}
