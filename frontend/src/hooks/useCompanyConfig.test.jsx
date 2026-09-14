import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCompanyConfig } from './useCompanyConfig';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('useCompanyConfig', () => {
  test('busca a configuração ao montar', async () => {
    api.getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });

    const { result } = renderHook(() => useCompanyConfig());

    await waitFor(() => expect(result.current.config.name).toBe('Provedor X'));
    expect(api.getCompanyConfig).toHaveBeenCalledWith('tok-123');
  });

  test('começa com o vazio padrão antes de a busca resolver', () => {
    api.getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [] });
    const { result } = renderHook(() => useCompanyConfig());
    expect(result.current.config).toEqual({ id: null, name: '', acceptedPayeeNames: [] });
  });

  test('refresh busca de novo', async () => {
    api.getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [] });
    const { result } = renderHook(() => useCompanyConfig());
    await waitFor(() => expect(api.getCompanyConfig).toHaveBeenCalledTimes(1));

    api.getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor Y', acceptedPayeeNames: ['Y Ltda'] });
    await act(() => result.current.refresh());

    expect(result.current.config.name).toBe('Provedor Y');
  });

  test('sem token não busca nada e mantém o vazio padrão', async () => {
    useAuth.mockReturnValue({ token: null });
    const { result } = renderHook(() => useCompanyConfig());
    expect(api.getCompanyConfig).not.toHaveBeenCalled();
    expect(result.current.config).toEqual({ id: null, name: '', acceptedPayeeNames: [] });
  });
});
