import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresence } from './usePresence';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/SocketContext');
vi.mock('../contexts/AuthContext');

function createFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    off: vi.fn(),
    trigger: (event, payload) => handlers[event] && handlers[event](payload),
  };
}

let fakeSocket;

beforeEach(() => {
  vi.clearAllMocks();
  fakeSocket = createFakeSocket();
  useSocket.mockReturnValue(fakeSocket);
  useAuth.mockReturnValue({ agent: { id: 'self-1' } });
});

describe('usePresence', () => {
  test('seeds the online set from the agents list online field, plus the current agent', () => {
    const agents = [
      { id: 'a1', online: true },
      { id: 'a2', online: false },
    ];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current).toEqual(new Set(['a1', 'self-1']));
  });

  test('always includes the current agent as online, even if the initial snapshot missed it', () => {
    const agents = [{ id: 'self-1', online: false }];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current.has('self-1')).toBe(true);
  });

  test('presence:online adds the agent to the online set', () => {
    const agents = [{ id: 'a1', online: false }];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current).toEqual(new Set(['self-1']));

    act(() => {
      fakeSocket.trigger('presence:online', { agentId: 'a1' });
    });

    expect(result.current).toEqual(new Set(['self-1', 'a1']));
  });

  test('presence:offline removes the agent from the online set', () => {
    const agents = [{ id: 'a1', online: true }];
    const { result } = renderHook(() => usePresence(agents));
    expect(result.current).toEqual(new Set(['a1', 'self-1']));

    act(() => {
      fakeSocket.trigger('presence:offline', { agentId: 'a1' });
    });

    expect(result.current).toEqual(new Set(['self-1']));
  });
});
