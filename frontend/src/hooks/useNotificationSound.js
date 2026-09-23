import { useState, useCallback } from 'react';
import { lerLocal, gravarLocal } from '../utils/armazenamentoLocal';

const MUTE_STORAGE_KEY = 'dw_queue_notification_muted';

export function playChime() {
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

export function useNotificationSound() {
  const [muted, setMuted] = useState(() => lerLocal(MUTE_STORAGE_KEY) === 'true');

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      gravarLocal(MUTE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { muted, toggleMuted, playChime };
}
