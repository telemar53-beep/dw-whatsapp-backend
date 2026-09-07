import { useEffect, useState, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';

const MUTE_STORAGE_KEY = 'dw_queue_notification_muted';

function playChime() {
  if (!window.AudioContext) return;
  const context = new window.AudioContext();
  const now = context.currentTime;
  [880, 1320].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const start = now + index * 0.12;
    gain.gain.setValueAtTime(0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    oscillator.start(start);
    oscillator.stop(start + 0.15);
  });
}

export function useQueueNotificationSound() {
  const socket = useSocket();
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_STORAGE_KEY) === 'true');

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!socket || muted) return undefined;
    socket.on('queue:new', playChime);
    return () => {
      socket.off('queue:new', playChime);
    };
  }, [socket, muted]);

  return { muted, toggleMuted };
}
