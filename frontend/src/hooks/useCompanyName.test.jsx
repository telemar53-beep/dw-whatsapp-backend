import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCompanyName } from './useCompanyName';
import * as api from '../services/api';

vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCompanyName', () => {
  // A rota pública é a única que um atendente comum pode chamar: a de admin
  // devolve 403 para ele, e o nome nunca apareceria no chat.
  test('busca o nome na rota pública, sem token', async () => {
    api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });

    const { result } = renderHook(() => useCompanyName());

    await waitFor(() => expect(result.current.name).toBe('Provedor X'));
    expect(api.getPublicCompany).toHaveBeenCalledWith();
    expect(api.getCompanyConfig).not.toHaveBeenCalled();
  });

  test('começa vazio antes de a busca resolver', () => {
    api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
    const { result } = renderHook(() => useCompanyName());
    expect(result.current.name).toBe('');
  });

  test('sem empresa cadastrada devolve vazio', async () => {
    api.getPublicCompany.mockResolvedValue({ name: '' });
    const { result } = renderHook(() => useCompanyName());
    await waitFor(() => expect(api.getPublicCompany).toHaveBeenCalled());
    expect(result.current.name).toBe('');
  });

  // A rota fora do ar não pode derrubar tela nenhuma: o nome só some.
  test('erro na busca não propaga e mantém o nome vazio', async () => {
    api.getPublicCompany.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCompanyName());
    await waitFor(() => expect(api.getPublicCompany).toHaveBeenCalled());
    expect(result.current.name).toBe('');
  });
});
