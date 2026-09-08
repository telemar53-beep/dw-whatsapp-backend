import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnreadMyConversations } from './useUnreadMyConversations';
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

const MY_CONVERSATIONS = [{ id: 'c1' }, { id: 'c2' }];

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  FakeAudioContext.instances = [];
  window.AudioContext = FakeAudioContext;
  fakeSocket = createFakeSocket();
  useSocket.mockReturnValue(fakeSocket);
});

describe('useUnreadMyConversations', () => {
  test('starts with no unread conversations', () => {
    const { result } = renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    expect(result.current.unreadIds.size).toBe(0);
  });

  test('marks a conversation unread when an inbound message arrives for it and it is not selected', () => {
    const { result } = renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'inbound' } });
    });
    expect(result.current.unreadIds.has('c1')).toBe(true);
  });

  test('plays a sound when marking a conversation unread', () => {
    renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'inbound' } });
    });
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  test('does not play a sound when muted', () => {
    localStorage.setItem('dw_queue_notification_muted', 'true');
    renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'inbound' } });
    });
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  test('ignores an outbound message (the agent sending, not the customer replying)', () => {
    const { result } = renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'outbound' } });
    });
    expect(result.current.unreadIds.size).toBe(0);
  });

  test('ignores a message for the conversation that is currently selected', () => {
    const { result } = renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, 'c1'));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'inbound' } });
    });
    expect(result.current.unreadIds.size).toBe(0);
  });

  test('ignores a message for a conversation that is not in myConversations', () => {
    const { result } = renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'not-mine' }, message: { direction: 'inbound' } });
    });
    expect(result.current.unreadIds.size).toBe(0);
  });

  test('clearUnread removes a conversation from the unread set', () => {
    const { result } = renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null));
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'inbound' } });
    });
    expect(result.current.unreadIds.has('c1')).toBe(true);

    act(() => {
      result.current.clearUnread('c1');
    });
    expect(result.current.unreadIds.has('c1')).toBe(false);
  });

  test('prunes an unread id once its conversation leaves myConversations (closed or transferred away)', () => {
    const { result, rerender } = renderHook(({ conversations, selectedId }) => useUnreadMyConversations(conversations, selectedId), {
      initialProps: { conversations: MY_CONVERSATIONS, selectedId: null },
    });
    act(() => {
      fakeSocket.trigger('message:new', { conversation: { id: 'c1' }, message: { direction: 'inbound' } });
    });
    expect(result.current.unreadIds.has('c1')).toBe(true);

    rerender({ conversations: [{ id: 'c2' }], selectedId: null });
    expect(result.current.unreadIds.has('c1')).toBe(false);
  });

  test('does nothing when there is no socket connection yet', () => {
    useSocket.mockReturnValue(null);
    expect(() => renderHook(() => useUnreadMyConversations(MY_CONVERSATIONS, null))).not.toThrow();
  });
});
