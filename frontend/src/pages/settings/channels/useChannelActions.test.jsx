import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChannelActions } from './useChannelActions';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
});

// Migrado de AdminChannelsPage.test.jsx (238-520): os mesmos handlers, agora
// exercitados direto no hook via renderHook, sem precisar montar a tela.
describe('useChannelActions', () => {
  test('toggleTriage chama a API e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelTriageEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleTriage('ch1', true));

    expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(refresh).toHaveBeenCalled();
    expect(result.current.errors.triage).toBeNull();
  });

  test('erro ao alternar a triagem preenche errors.triage', async () => {
    const refresh = vi.fn();
    api.setChannelTriageEnabled.mockRejectedValue({ body: { error: 'Canal não encontrado' } });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleTriage('ch1', true));

    expect(result.current.errors.triage).toBe('Canal não encontrado');
  });

  test('ligar a IA também desliga a triagem por menu do canal, nessa ordem, e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockResolvedValue({});
    api.setChannelTriageEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAi('ch1', true));

    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', false, 'tok-123');
    expect(api.setChannelAiEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      api.setChannelTriageEnabled.mock.invocationCallOrder[0]
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('desligar a IA não mexe na triagem', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAi('ch1', false));

    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', false, 'tok-123');
    expect(api.setChannelTriageEnabled).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  test('erro ao ligar a IA preenche errors.ai', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockRejectedValue({ body: { error: 'Canal não encontrado' } });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAi('ch1', true));

    expect(result.current.errors.ai).toBe('Canal não encontrado');
    expect(refresh).toHaveBeenCalled();
  });

  // Mesmo com a IA ligada com sucesso, se a segunda chamada (desligar a
  // triagem) falhar, o refresh() ainda roda no finally — a tela precisa
  // parar de mostrar o estado antigo (anterior ao clique) e refletir o
  // estado real do canal junto com o erro.
  test('quando a IA liga mas desligar a triagem falha, mostra o erro e ainda assim recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockResolvedValue({});
    api.setChannelTriageEnabled.mockRejectedValue({ body: { error: 'Falha ao desligar a triagem' } });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAi('ch1', true));

    expect(result.current.errors.ai).toBe('Falha ao desligar a triagem');
    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', false, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('toggleAiTriage chama a API e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelAiTriageEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAiTriage('ch1', true));

    expect(api.setChannelAiTriageEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('erro ao alternar a triagem com IA preenche errors.aiTriage', async () => {
    const refresh = vi.fn();
    api.setChannelAiTriageEnabled.mockRejectedValue({ body: { error: 'Canal não encontrado' } });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAiTriage('ch1', true));

    expect(result.current.errors.aiTriage).toBe('Canal não encontrado');
  });

  test('toggleAiNightMode chama a API e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelAiNightModeEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAiNightMode('ch1', true));

    expect(api.setChannelAiNightModeEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('erro ao ligar o atendimento noturno preenche errors.aiNightMode', async () => {
    const refresh = vi.fn();
    api.setChannelAiNightModeEnabled.mockRejectedValue({ body: { error: 'aiNightModeEnabled requires aiTriageEnabled' } });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAiNightMode('ch1', true));

    expect(result.current.errors.aiNightMode).toBe('aiNightModeEnabled requires aiTriageEnabled');
  });

  // Revisão final do branch original: a recusa por janela vazia é o erro que
  // o admin mais vai ver (a config sai do banco sem janela).
  test('recusa por janela noturna não configurada aparece em errors.aiNightMode', async () => {
    const refresh = vi.fn();
    api.setChannelAiNightModeEnabled.mockRejectedValue({
      body: { error: 'aiNightModeEnabled requires the night window (nightStartTime/nightEndTime) in the AI triage config' },
    });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.toggleAiNightMode('ch1', true));

    expect(result.current.errors.aiNightMode).toMatch(/requires the night window/i);
  });

  test('saveWabaId chama a API com o valor recebido e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelWabaId.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.saveWabaId('ch1', 'new-waba'));

    expect(api.setChannelWabaId).toHaveBeenCalledWith('ch1', 'new-waba', 'tok-123');
    expect(refresh).toHaveBeenCalled();
  });

  test('erro ao salvar o WABA ID preenche errors.wabaId', async () => {
    const refresh = vi.fn();
    api.setChannelWabaId.mockRejectedValue({ body: { error: 'Falha ao atualizar o WABA ID' } });
    const { result } = renderHook(() => useChannelActions(refresh));

    await act(() => result.current.saveWabaId('ch1', 'new-waba'));

    expect(result.current.errors.wabaId).toBe('Falha ao atualizar o WABA ID');
  });
});
