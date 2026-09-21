import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiTriageForm } from './useAiTriageForm';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

const saved = {
  triageConfidenceThreshold: 0.65, triageMaxQuestions: 4, triageTimeoutMinutes: 12, triageExtraInstructions: 'seja breve',
  triageResolvedReasonId: 'r1', nightStartTime: '21:00', nightEndTime: '07:00', triageReadReceiptsDaytime: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok' });
  useAiConfig.mockReturnValue({ config: saved, status: 'ready', loading: false, refresh: vi.fn() });
  // O save agora relê a configuração ANTES de gravar, para não reverter o que
  // outra tela mudou nesse meio-tempo.
  api.getAiConfig.mockResolvedValue(saved);
  api.updateAiTriageConfig.mockResolvedValue({});
});

describe('useAiTriageForm', () => {
  test('carrega os oito campos da config', () => {
    const { result } = renderHook(() => useAiTriageForm());
    expect(result.current.values).toEqual({
      confidencePercent: 65, maxQuestions: 4, timeoutMinutes: 12, extraInstructions: 'seja breve', resolvedReasonId: 'r1',
      readReceiptsDaytime: false, nightStart: '21:00', nightEnd: '07:00',
    });
  });
  test('mudar só a janela e salvar envia os oito campos, com os outros intactos', async () => {
    const { result } = renderHook(() => useAiTriageForm());
    act(() => result.current.setValue('nightStart', '20:00'));
    await act(() => result.current.save());
    expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
      {
        triageConfidenceThreshold: 0.65, triageMaxQuestions: 4, triageTimeoutMinutes: 12, triageExtraInstructions: 'seja breve',
        triageResolvedReasonId: 'r1', nightStartTime: '20:00', nightEndTime: '07:00', triageReadReceiptsDaytime: false,
      },
      'tok'
    );
  });
  test('config sem janela nasce vazia e salva null', async () => {
    useAiConfig.mockReturnValue({ config: { ...saved, nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
    const { result } = renderHook(() => useAiTriageForm());
    expect(result.current.values.nightStart).toBe('');
    expect(result.current.values.nightEnd).toBe('');

    await act(() => result.current.save());
    expect(api.updateAiTriageConfig.mock.calls[0][0].nightStartTime).toBe(null);
    expect(api.updateAiTriageConfig.mock.calls[0][0].nightEndTime).toBe(null);
  });
  test('meia janela é recusada antes de chamar a API', async () => {
    const { result } = renderHook(() => useAiTriageForm());
    act(() => result.current.setValue('nightEnd', ''));
    await act(() => result.current.save());
    expect(api.updateAiTriageConfig).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/início e fim/i);
  });
  test('motivo vazio vai como null', async () => {
    const { result } = renderHook(() => useAiTriageForm());
    act(() => result.current.setValue('resolvedReasonId', ''));
    await act(() => result.current.save());
    expect(api.updateAiTriageConfig.mock.calls[0][0].triageResolvedReasonId).toBe(null);
  });
});
