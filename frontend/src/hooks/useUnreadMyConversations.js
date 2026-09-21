import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useNotificationSound } from './useNotificationSound';

// `observadas` são as conversas que também recebem o sinal de mensagem nova
// sem tocar o som: Espera e Automação. Antes só "meus atendimentos" eram
// marcados, então um cliente que mandava cinco mensagens na fila ficava
// visualmente idêntico ao que mandou uma. O som da fila continua sendo
// responsabilidade do useQueueNotificationSound — aqui seria som dobrado.
export function useUnreadMyConversations(myConversations, selectedConversationId, observadas = []) {
  const socket = useSocket();
  const { muted, playChime } = useNotificationSound();
  const [unreadIds, setUnreadIds] = useState(() => new Set());

  useEffect(() => {
    if (!socket) return undefined;

    function marcar(conversation, message, comSom) {
      if (!message || message.direction !== 'inbound') return;
      if (conversation.id === selectedConversationId) return;
      setUnreadIds((prev) => (prev.has(conversation.id) ? prev : new Set(prev).add(conversation.id)));
      if (comSom && !muted) playChime();
    }

    function onNew({ conversation, message }) {
      if (!conversation) return;
      if (myConversations.some((c) => c.id === conversation.id)) {
        marcar(conversation, message, true);
        return;
      }
      if (observadas.some((c) => c.id === conversation.id)) marcar(conversation, message, false);
    }

    // Em Espera e Automação (sem atendente) a mensagem do cliente chega só
    // como queue:new; sem este ouvinte a fila nunca acenderia.
    function onQueueNew({ conversation, message }) {
      if (!conversation || !message) return;
      if (observadas.some((c) => c.id === conversation.id)) marcar(conversation, message, false);
    }

    socket.on('message:new', onNew);
    socket.on('queue:new', onQueueNew);
    return () => {
      socket.off('message:new', onNew);
      socket.off('queue:new', onQueueNew);
    };
  }, [socket, selectedConversationId, myConversations, observadas, muted, playChime]);

  // Sai da lista, sai a marca — agora contando também as observadas, senão
  // uma conversa que deixa a fila deixaria o id preso aqui para sempre.
  useEffect(() => {
    setUnreadIds((prev) => {
      const stillPresent = new Set([...myConversations, ...observadas].map((c) => c.id));
      const next = new Set([...prev].filter((id) => stillPresent.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [myConversations, observadas]);

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
