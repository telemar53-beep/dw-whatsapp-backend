import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getAiSuggestion, sendAiSuggestion, discardAiSuggestion } from '../services/api';

export function useAiSuggestion(conversationId) {
  const { token } = useAuth();
  const socket = useSocket();
  const [suggestion, setSuggestion] = useState(null);

  useEffect(() => {
    if (!token || !conversationId) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    getAiSuggestion(conversationId, token)
      .then((data) => { if (!cancelled) setSuggestion(data.suggestion); })
      .catch(() => { if (!cancelled) setSuggestion(null); });
    return () => { cancelled = true; };
  }, [conversationId, token]);

  useEffect(() => {
    if (!socket) return undefined;
    function onSuggestion(payload) {
      // Só a conversa aberta: o socket entrega tudo do atendente.
      if (payload.conversationId !== conversationId) return;
      setSuggestion(payload.suggestion);
    }
    socket.on('ai:suggestion', onSuggestion);
    return () => socket.off('ai:suggestion', onSuggestion);
  }, [socket, conversationId]);

  const send = useCallback(
    async (item, content) => {
      setSuggestion(null);
      await sendAiSuggestion(conversationId, item.id, content, token);
    },
    [conversationId, token]
  );

  const discard = useCallback(
    async (item) => {
      setSuggestion(null);
      await discardAiSuggestion(conversationId, item.id, token);
    },
    [conversationId, token]
  );

  // edit não chama a API: o texto vai para o campo de digitação e a sugestão
  // some da tela. Ela só é marcada como 'edited' quando o atendente enviar.
  const edit = useCallback((item) => {
    setSuggestion(null);
    return item.content;
  }, []);

  return { suggestion, send, edit, discard };
}
