import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useNotificationSound } from './useNotificationSound';

// Aviso de "fulano transferiu um atendimento para você".
//
// O evento `conversation:assigned` também chega quando o próprio atendente pega
// uma conversa da fila — por isso o gatilho é o campo `transferredBy`, que só a
// rota de transferência envia. Sem ele não houve transferência, e nem o sino
// nem o aviso aparecem.
export function useTransferNotice() {
  const socket = useSocket();
  const { muted, playChime } = useNotificationSound();
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!socket) return undefined;

    function onAssigned({ conversation, transferredBy } = {}) {
      if (!transferredBy || !conversation) return;
      setNotice({
        conversationId: conversation.id,
        contactName: conversation.contactDisplayName || conversation.contactPhoneNumber,
        byName: transferredBy.name,
      });
      // Silenciar é sobre barulho, não sobre esconder informação: o aviso na
      // tela aparece de qualquer jeito.
      if (!muted) playChime();
    }

    socket.on('conversation:assigned', onAssigned);
    return () => {
      socket.off('conversation:assigned', onAssigned);
    };
  }, [socket, muted, playChime]);

  const dismiss = useCallback(() => setNotice(null), []);

  return { notice, dismiss };
}
