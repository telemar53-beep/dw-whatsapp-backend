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

    // A mesma mensagem pode chegar duas vezes (o envio pelo GET e o
    // message:new do servidor; queue:new e message:new): pelo id, a segunda
    // só completa a primeira em vez de duplicar a bolha.
    function acrescentar(message) {
      setMessages((prev) => (prev.some((m) => m.id === message.id)
        ? prev.map((m) => (m.id === message.id ? { ...m, ...message } : m))
        : [...prev, message]));
    }

    function onNew({ conversation, message }) {
      if (conversation.id !== conversationId) return;
      acrescentar(message);
    }

    // Em Automação/Espera (sem atendente) a mensagem do cliente chega só como
    // queue:new (teste real 2026-09-15: a lista atualizava e o som tocava, mas
    // a conversa aberta só mostrava a bolha no F5).
    function onQueueNew({ conversation, message }) {
      if (!message || !conversation || conversation.id !== conversationId) return;
      acrescentar(message);
    }

    function onUpdated({ conversationId: updatedId, message }) {
      if (updatedId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
    }

    function onTranscription({ conversationId: msgConversationId, messageId, transcription, transcriptionStatus, transcriptionDetail }) {
      if (msgConversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, transcription, transcriptionStatus, transcriptionDetail } : m
        )
      );
    }

    socket.on('message:new', onNew);
    socket.on('queue:new', onQueueNew);
    socket.on('message:updated', onUpdated);
    socket.on('message:transcription', onTranscription);
    return () => {
      socket.off('message:new', onNew);
      socket.off('queue:new', onQueueNew);
      socket.off('message:updated', onUpdated);
      socket.off('message:transcription', onTranscription);
    };
  }, [socket, conversationId]);

  const appendMessage = useCallback((message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const sendMessage = useCallback(
    async (content, file, repliedToMessageId, isVoiceNote) => {
      const created = await apiSendMessage(conversationId, content, token, file, repliedToMessageId, isVoiceNote);
      appendMessage(created);
      return created;
    },
    [conversationId, token, appendMessage]
  );

  return { messages, sendMessage, appendMessage };
}
