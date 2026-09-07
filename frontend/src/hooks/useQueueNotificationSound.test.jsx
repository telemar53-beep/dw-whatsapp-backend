import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueNotificationSound } from './useQueueNotificationSound';
import { useSocket } from '../contexts/SocketContext';

vi.mock('../contexts/SocketContext');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn((event) => {
      delete handlers[event];
    }),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

class FakeOscillator {
  constructor() {
    this.frequency = { value: 0 };
    this.connect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }
}

class FakeGain {
  constructor() {
    this.gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    this.connect = vi.fn();
  }
}

class FakeAudioContext {
  constructor() {
    FakeAudioContext.instances.push(this);
    this.currentTime = 0;
    this.destination = {};
  }
  createOscillator() {
    return new FakeOscillator();
  }
  createGain() {
    return new FakeGain();
  }
}
FakeAudioContext.instances = [];

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  FakeAudioContext.instances = [];
  window.AudioContext = FakeAudioContext;
  fakeSocket = createFakeSocket();
  useSocket.mockReturnValue(fakeSocket);
});

describe('useQueueNotificationSound', () => {
  test('does not play a sound on mount', () => {
    renderHook(() => useQueueNotificationSound());
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  test('plays a sound when a new conversation arrives in the queue', () => {
    renderHook(() => useQueueNotificationSound());
    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c1' } });
    });
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  test('starts unmuted by default', () => {
    const { result } = renderHook(() => useQueueNotificationSound());
    expect(result.current.muted).toBe(false);
  });

  test('starts muted when localStorage has the mute preference saved', () => {
    localStorage.setItem('dw_queue_notification_muted', 'true');
    const { result } = renderHook(() => useQueueNotificationSound());
    expect(result.current.muted).toBe(true);
  });

  test('toggleMuted flips the state and persists it to localStorage', () => {
    const { result } = renderHook(() => useQueueNotificationSound());

    act(() => {
      result.current.toggleMuted();
    });
    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem('dw_queue_notification_muted')).toBe('true');

    act(() => {
      result.current.toggleMuted();
    });
    expect(result.current.muted).toBe(false);
    expect(localStorage.getItem('dw_queue_notification_muted')).toBe('false');
  });

  test('does not play a sound when muted', () => {
    localStorage.setItem('dw_queue_notification_muted', 'true');
    renderHook(() => useQueueNotificationSound());
    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c1' } });
    });
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  test('stops playing sounds after being muted mid-session', () => {
    const { result } = renderHook(() => useQueueNotificationSound());
    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c1' } });
    });
    expect(FakeAudioContext.instances).toHaveLength(1);

    act(() => {
      result.current.toggleMuted();
    });
    act(() => {
      fakeSocket.trigger('queue:new', { conversation: { id: 'c2' } });
    });
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  test('does nothing when there is no socket connection yet', () => {
    useSocket.mockReturnValue(null);
    expect(() => renderHook(() => useQueueNotificationSound())).not.toThrow();
  });
});
