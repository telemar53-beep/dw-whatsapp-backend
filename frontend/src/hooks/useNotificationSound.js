import { useState, useCallback } from 'react';
import { lerLocal, gravarLocal } from '../utils/armazenamentoLocal';

const MUTE_STORAGE_KEY = 'dw_queue_notification_muted';

// AudioContext é um recurso caro, e o normal é reutilizar um só por
// documento/aba. Antes, cada toque criava um contexto novo. Agora existe um
// único contexto compartilhado, criado no primeiro som, e os toques seguintes
// o reutilizam, sem adquirir de novo os recursos de áudio a cada som.
//
// O efeito disso sobre a lentidão do BUG-004 (achado A1) ainda precisa ser
// medido.
//
// Não é fechado depois do toque: isso voltaria a criar um por som. Quem o
// libera é o fim do documento.
let contextoCompartilhado = null;

function contextoDoSom() {
  if (!window.AudioContext) return null;
  if (!contextoCompartilhado || contextoCompartilhado.state === 'closed') {
    contextoCompartilhado = new window.AudioContext();
  }
  return contextoCompartilhado;
}

export function playChime() {
  const context = contextoDoSom();
  if (!context) return;
  // Criado antes de a página ter recebido um clique, o contexto nasce
  // suspenso. O resume é recusado enquanto não houver gesto do usuário, e
  // então o toque some em silêncio, como já sumia — nunca como erro.
  if (context.state === 'suspended') {
    Promise.resolve(context.resume()).catch(() => {});
  }
  // O relógio do contexto reaproveitado não volta a zero: o toque é agendado a
  // partir de agora, nunca do começo dele.
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
    // Os nós são deste toque; o contexto fica. Sem isto, cada som deixaria
    // duas ligações penduradas na saída do contexto compartilhado.
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
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
