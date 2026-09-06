import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQuickReplies } from './useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useQuickReplies', () => {
  test('fetches quick replies on mount', async () => {
    api.listQuickReplies.mockResolvedValue([{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }]);

    const { result } = renderHook(() => useQuickReplies());

    await waitFor(() => expect(result.current.quickReplies).toEqual([{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }]));
    expect(api.listQuickReplies).toHaveBeenCalledWith('tok-123');
  });

  test('refresh refetches the list', async () => {
    api.listQuickReplies.mockResolvedValue([]);
    const { result } = renderHook(() => useQuickReplies());
    await waitFor(() => expect(api.listQuickReplies).toHaveBeenCalledTimes(1));

    api.listQuickReplies.mockResolvedValue([{ id: 'qr-2', title: 'Nova', content: 'Texto' }]);
    await act(() => result.current.refresh());

    expect(result.current.quickReplies).toEqual([{ id: 'qr-2', title: 'Nova', content: 'Texto' }]);
  });
});
