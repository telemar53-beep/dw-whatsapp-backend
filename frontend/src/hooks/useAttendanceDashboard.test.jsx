import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAttendanceDashboard } from './useAttendanceDashboard';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { getDashboardConversations } from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../services/api');

function makeFakeSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    off: vi.fn(),
    emit(event, payload) {
      handlers[event] && handlers[event](payload);
    },
  };
}

describe('useAttendanceDashboard', () => {
  let socket;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ token: 'tok-123' });
    socket = makeFakeSocket();
    useSocket.mockReturnValue(socket);
  });

  test('fetches the initial snapshot on mount', async () => {
    getDashboardConversations.mockResolvedValue({
      inProgress: [{ id: 'c1', status: 'assigned' }],
      waiting: [{ id: 'c2', status: 'waiting', triageState: null }],
      inAutomation: [{ id: 'c3', status: 'waiting', triageState: 'pending' }],
      closedTodayCount: 4,
    });

    const { result } = renderHook(() => useAttendanceDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.inProgress).toEqual([{ id: 'c1', status: 'assigned' }]);
    expect(result.current.waiting).toEqual([{ id: 'c2', status: 'waiting', triageState: null }]);
    expect(result.current.inAutomation).toEqual([{ id: 'c3', status: 'waiting', triageState: 'pending' }]);
    expect(result.current.closedTodayCount).toBe(4);
  });

  test('upserts an assigned conversation into inProgress and removes it from the other lists on a dashboard:conversation event', async () => {
    getDashboardConversations.mockResolvedValue({
      inProgress: [],
      waiting: [{ id: 'c1', status: 'waiting', triageState: null }],
      inAutomation: [],
      closedTodayCount: 0,
    });
    const { result } = renderHook(() => useAttendanceDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      socket.emit('dashboard:conversation', { conversation: { id: 'c1', status: 'assigned', triageState: 'completed' } });
    });

    expect(result.current.inProgress).toEqual([{ id: 'c1', status: 'assigned', triageState: 'completed' }]);
    expect(result.current.waiting).toEqual([]);
  });

  test('moves a conversation into inAutomation when triageState becomes pending', async () => {
    getDashboardConversations.mockResolvedValue({ inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0 });
    const { result } = renderHook(() => useAttendanceDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      socket.emit('dashboard:conversation', { conversation: { id: 'c9', status: 'waiting', triageState: 'pending' } });
    });

    expect(result.current.inAutomation).toEqual([{ id: 'c9', status: 'waiting', triageState: 'pending' }]);
    expect(result.current.waiting).toEqual([]);
  });

  test('removes a conversation from every live list when it closes, and increments closedTodayCount', async () => {
    getDashboardConversations.mockResolvedValue({
      inProgress: [{ id: 'c1', status: 'assigned' }],
      waiting: [],
      inAutomation: [],
      closedTodayCount: 2,
    });
    const { result } = renderHook(() => useAttendanceDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      socket.emit('dashboard:conversation', {
        conversation: { id: 'c1', status: 'closed' },
        closedAt: '2026-09-09T12:00:00.000Z',
      });
    });

    expect(result.current.inProgress).toEqual([]);
    expect(result.current.closedTodayCount).toBe(3);
  });
});
