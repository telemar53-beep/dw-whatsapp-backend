import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTemplates } from './useTemplates';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useTemplates', () => {
  test('fetches templates on mount', async () => {
    api.listTemplatesAdmin.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.templates).toEqual([{ id: 'tpl-1', name: 'fatura_vencida' }]);
  });

  test('refresh re-fetches the list', async () => {
    api.listTemplatesAdmin.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'tpl-2' }]);
    const { result } = renderHook(() => useTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.templates).toEqual([{ id: 'tpl-2' }]);
  });
});
