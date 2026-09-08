import { useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useNotificationSound } from './useNotificationSound';

export function useQueueNotificationSound() {
  const socket = useSocket();
  const { muted, toggleMuted, playChime } = useNotificationSound();

  useEffect(() => {
    if (!socket || muted) return undefined;
    socket.on('queue:new', playChime);
    return () => {
      socket.off('queue:new', playChime);
    };
  }, [socket, muted, playChime]);

  return { muted, toggleMuted };
}
