import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBusinessHoursConfig } from './useBusinessHoursConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useBusinessHoursConfig', () => {
  test('fetches the config on mount', async () => {
    api.getBusinessHoursConfig.mockResolvedValue({
      enabled: true,
      startTime: '09:00',
      endTime: '17:00',
      message: 'fora do horário',
    });

    const { result } = renderHook(() => useBusinessHoursConfig());

    await waitFor(() => expect(result.current.config.enabled).toBe(true));
    expect(api.getBusinessHoursConfig).toHaveBeenCalledWith('tok-123');
  });

  test('starts with the empty default before the fetch resolves', () => {
    api.getBusinessHoursConfig.mockResolvedValue({ id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' });
    const { result } = renderHook(() => useBusinessHoursConfig());
    expect(result.current.config).toEqual({ id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' });
  });

  test('refresh refetches the config', async () => {
    api.getBusinessHoursConfig.mockResolvedValue({ enabled: false, startTime: '08:00', endTime: '18:00', message: '' });
    const { result } = renderHook(() => useBusinessHoursConfig());
    await waitFor(() => expect(api.getBusinessHoursConfig).toHaveBeenCalledTimes(1));

    api.getBusinessHoursConfig.mockResolvedValue({ enabled: true, startTime: '09:00', endTime: '17:00', message: 'novo aviso' });
    await act(() => result.current.refresh());

    expect(result.current.config.message).toBe('novo aviso');
  });
});
