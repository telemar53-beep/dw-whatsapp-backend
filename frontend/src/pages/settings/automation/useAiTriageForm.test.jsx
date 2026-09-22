import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAiTriageForm, CAMPOS_DA_TRIAGEM, CAMPOS_DO_NOTURNO, CAMPOS_DA_IDENTIFICACAO } from './useAiTriageForm';
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
  api.patchAiTriageConfig.mockResolvedValue({});
});

function corpoEnviado() {
  return api.patchAiTriageConfig.mock.calls[0][0];
}

describe('useAiTriageForm', () => {
  test('carrega os oito campos da config', () => {
    const { result } = renderHook(() => useAiTriageForm());
    expect(result.current.values).toEqual({
      confidencePercent: 65, maxQuestions: 4, timeoutMinutes: 12, extraInstructions: 'seja breve', resolvedReasonId: 'r1',
      readReceiptsDaytime: false, nightStart: '21:00', nightEnd: '07:00',
    });
  });

  // Três páginas editam pedaços da MESMA linha. Cada uma manda só o que é
  // dela; o backend não encosta em coluna que não veio.
  test('a página do noturno manda só a janela', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DO_NOTURNO));
    act(() => result.current.setValue('nightStart', '20:00'));
    await act(() => result.current.save());

    expect(api.patchAiTriageConfig).toHaveBeenCalledWith(
      { nightStartTime: '20:00', nightEndTime: '07:00' },
      'tok'
    );
    expect(Object.keys(corpoEnviado()).sort()).toEqual(['nightEndTime', 'nightStartTime']);
  });

  test('a página da triagem manda só os cinco campos dela', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_TRIAGEM));
    await act(() => result.current.save());

    expect(Object.keys(corpoEnviado()).sort()).toEqual([
      'triageConfidenceThreshold', 'triageExtraInstructions', 'triageMaxQuestions',
      'triageResolvedReasonId', 'triageTimeoutMinutes',
    ]);
    expect('nightStartTime' in corpoEnviado()).toBe(false);
    expect('triageReadReceiptsDaytime' in corpoEnviado()).toBe(false);
  });

  test('a página da identificação manda só o campo dela', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_IDENTIFICACAO));
    await act(() => result.current.save());

    expect(api.patchAiTriageConfig).toHaveBeenCalledWith({ triageReadReceiptsDaytime: false }, 'tok');
    expect(Object.keys(corpoEnviado())).toEqual(['triageReadReceiptsDaytime']);
  });

  // `false`, `0` e `''` são valores, não ausência: quando pertencem à tela,
  // vão inteiros. O que decide "não mexe" é a chave não estar no corpo.
  test('false é enviado como false quando o campo é da tela', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_IDENTIFICACAO));
    act(() => result.current.setValue('readReceiptsDaytime', false));
    await act(() => result.current.save());

    expect(corpoEnviado().triageReadReceiptsDaytime).toBe(false);
  });

  test('0 é enviado como zero', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_TRIAGEM));
    act(() => result.current.setValue('maxQuestions', 0));
    act(() => result.current.setValue('confidencePercent', 0));
    await act(() => result.current.save());

    expect(corpoEnviado().triageMaxQuestions).toBe(0);
    expect(corpoEnviado().triageConfidenceThreshold).toBe(0);
  });

  test('instrução vazia é enviada como texto vazio, não como null', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_TRIAGEM));
    act(() => result.current.setValue('extraInstructions', ''));
    await act(() => result.current.save());

    expect(corpoEnviado().triageExtraInstructions).toBe('');
  });

  // Vazio no motivo e nas horas é DESLIGAR, e por isso vira null.
  test('motivo vazio vai como null', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_TRIAGEM));
    act(() => result.current.setValue('resolvedReasonId', ''));
    await act(() => result.current.save());

    expect(corpoEnviado().triageResolvedReasonId).toBe(null);
  });

  test('config sem janela nasce vazia e salva null', async () => {
    useAiConfig.mockReturnValue({ config: { ...saved, nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DO_NOTURNO));
    expect(result.current.values.nightStart).toBe('');
    expect(result.current.values.nightEnd).toBe('');

    await act(() => result.current.save());

    expect(corpoEnviado().nightStartTime).toBe(null);
    expect(corpoEnviado().nightEndTime).toBe(null);
  });

  test('meia janela é recusada antes de chamar a API', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DO_NOTURNO));
    act(() => result.current.setValue('nightEnd', ''));
    await act(() => result.current.save());

    expect(api.patchAiTriageConfig).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/início e fim/i);
  });

  // Quem não edita a janela não tem como gravar metade dela: esses campos nem
  // entram no corpo.
  test('a página da triagem com meia janela em cache salva normalmente', async () => {
    useAiConfig.mockReturnValue({ config: { ...saved, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DA_TRIAGEM));

    await act(() => result.current.save());

    expect(api.patchAiTriageConfig).toHaveBeenCalled();
    expect('nightStartTime' in corpoEnviado()).toBe(false);
    expect('nightEndTime' in corpoEnviado()).toBe(false);
  });

  // A releitura antes do save existia só para mitigar o update total. Com o
  // PATCH não há o que preservar, e ela custava uma chamada por save.
  test('não relê a configuração antes de salvar', async () => {
    const { result } = renderHook(() => useAiTriageForm(CAMPOS_DO_NOTURNO));
    await act(() => result.current.save());

    expect(api.getAiConfig).not.toHaveBeenCalled();
  });

  test('o PUT antigo não é mais usado por nenhuma das telas', async () => {
    for (const campos of [CAMPOS_DA_TRIAGEM, CAMPOS_DO_NOTURNO, CAMPOS_DA_IDENTIFICACAO]) {
      const { result } = renderHook(() => useAiTriageForm(campos));
      await act(() => result.current.save());
    }

    expect(api.updateAiTriageConfig).not.toHaveBeenCalled();
  });
});
