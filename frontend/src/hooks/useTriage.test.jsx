import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTriage } from './useTriage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useTriage', () => {
  test('fetches the config and options on mount', async () => {
    api.getTriage.mockResolvedValue({
      questionText: 'Pergunta',
      confirmationText: 'Confirmação',
      maxAttempts: 2,
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: ['fatura'] }],
    });

    const { result } = renderHook(() => useTriage());

    await waitFor(() => expect(result.current.config).toEqual({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 }));
    expect(result.current.options).toEqual([{ id: 'opt-1', optionNumber: 1, sectorId: 's1', sectorName: 'Financeiro', keywords: ['fatura'] }]);
  });

  test('refresh refetches the data', async () => {
    api.getTriage.mockResolvedValue({ questionText: 'A', confirmationText: 'B', maxAttempts: 1, options: [] });
    const { result } = renderHook(() => useTriage());
    await waitFor(() => expect(result.current.config).not.toBeNull());

    api.getTriage.mockResolvedValue({ questionText: 'C', confirmationText: 'D', maxAttempts: 5, options: [] });
    await result.current.refresh();

    await waitFor(() => expect(result.current.config.questionText).toBe('C'));
  });
});
