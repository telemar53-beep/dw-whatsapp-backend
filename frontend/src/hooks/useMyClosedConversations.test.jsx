import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMyClosedConversations } from './useMyClosedConversations';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useMyClosedConversations', () => {
  test('fetches the first page on mount', async () => {
    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c1' }], hasMore: false });

    const { result } = renderHook(() => useMyClosedConversations());

    await waitFor(() => expect(result.current.items).toEqual([{ id: 'c1' }]));
    expect(api.getMyClosedConversations).toHaveBeenCalledWith({ offset: 0, limit: 20 }, 'tok-123');
    expect(result.current.hasMore).toBe(false);
  });

  test('starts with an empty list and loading true before the fetch resolves', () => {
    api.getMyClosedConversations.mockResolvedValue({ items: [], hasMore: false });
    const { result } = renderHook(() => useMyClosedConversations());
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  test('loadMore appends the next page using the current item count as the offset', async () => {
    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c1' }], hasMore: true });
    const { result } = renderHook(() => useMyClosedConversations());
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'c1' }]));

    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c2' }], hasMore: false });
    await act(() => result.current.loadMore());

    expect(api.getMyClosedConversations).toHaveBeenLastCalledWith({ offset: 1, limit: 20 }, 'tok-123');
    expect(result.current.items).toEqual([{ id: 'c1' }, { id: 'c2' }]);
    expect(result.current.hasMore).toBe(false);
  });

  test('refresh replaces the list from the start', async () => {
    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c1' }], hasMore: false });
    const { result } = renderHook(() => useMyClosedConversations());
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'c1' }]));

    api.getMyClosedConversations.mockResolvedValue({ items: [{ id: 'c2' }], hasMore: false });
    await act(() => result.current.refresh());

    expect(api.getMyClosedConversations).toHaveBeenLastCalledWith({ offset: 0, limit: 20 }, 'tok-123');
    expect(result.current.items).toEqual([{ id: 'c2' }]);
  });
});
