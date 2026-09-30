import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useChannelActions } from './useChannelActions';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
});

function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((ok, falha) => { resolver = ok; rejeitar = falha; });
  return { promessa, resolver, rejeitar };
}

// Dados fictícios.
const conectado = { id: 'ch1', name: 'Canal Suporte', type: 'baileys', status: 'connected' };
const aguardando = { id: 'ch2', name: 'Canal Vendas', type: 'baileys', status: 'awaiting_qr' };

// As ações com o diálogo montado: a confirmação é parte do hook desde a S2.
function Palco({ refresh, aoConcluir, expor }) {
  const actions = useChannelActions(refresh, { aoConcluir });
  expor(actions);
  return actions.dialogo;
}
function montarPalco({ refresh = vi.fn(), aoConcluir = vi.fn() } = {}) {
  const ref = { atual: null };
  render(<Palco refresh={refresh} aoConcluir={aoConcluir} expor={(a) => { ref.atual = a; }} />);
  return { ref, refresh, aoConcluir };
}

describe('useChannelActions: atendimento e identificação (a promessa carrega o erro seguro)', () => {
  test('definirTriagem chama a API e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelTriageEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));
    await act(() => result.current.definirTriagem('ch1', true));
    expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('falha na triagem: rejeita com a mensagem em português e não recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelTriageEnabled.mockRejectedValue({ body: { error: 'Channel not found' } });
    const { result } = renderHook(() => useChannelActions(refresh));
    await expect(result.current.definirTriagem('ch1', true)).rejects.toThrow('Canal não encontrado.');
    expect(refresh).not.toHaveBeenCalled();
  });

  test('ligar a IA também desliga a triagem por menu do canal, nessa ordem, e recarrega', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockResolvedValue({});
    api.setChannelTriageEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));
    await act(() => result.current.definirIa('ch1', true));
    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', false, 'tok-123');
    expect(api.setChannelAiEnabled.mock.invocationCallOrder[0]).toBeLessThan(api.setChannelTriageEnabled.mock.invocationCallOrder[0]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('desligar a IA não mexe na triagem', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));
    await act(() => result.current.definirIa('ch1', false));
    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', false, 'tok-123');
    expect(api.setChannelTriageEnabled).not.toHaveBeenCalled();
  });

  test('a IA liga mas desligar a triagem falha: rejeita e ainda assim recarrega, para a tela mostrar o estado real', async () => {
    const refresh = vi.fn();
    api.setChannelAiEnabled.mockResolvedValue({});
    api.setChannelTriageEnabled.mockRejectedValue({ body: { error: 'triageEnabled failed' } });
    const { result } = renderHook(() => useChannelActions(refresh));
    await expect(result.current.definirIa('ch1', true)).rejects.toThrow('Não foi possível salvar o atendimento com IA. Tente novamente.');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('definirTriagemIa e definirNoturno chamam as APIs de antes', async () => {
    api.setChannelAiTriageEnabled.mockResolvedValue({});
    api.setChannelAiNightModeEnabled.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(vi.fn()));
    await act(() => result.current.definirTriagemIa('ch1', true));
    await act(() => result.current.definirNoturno('ch1', false));
    expect(api.setChannelAiTriageEnabled).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(api.setChannelAiNightModeEnabled).toHaveBeenCalledWith('ch1', false, 'tok-123');
  });

  test('as recusas do noturno viram instruções em português', async () => {
    const { result } = renderHook(() => useChannelActions(vi.fn()));
    api.setChannelAiNightModeEnabled.mockRejectedValueOnce({ body: { error: 'aiNightModeEnabled requires aiTriageEnabled' } });
    await expect(result.current.definirNoturno('ch1', true)).rejects.toThrow('Ligue a Triagem com IA antes do Atendimento noturno.');
    api.setChannelAiNightModeEnabled.mockRejectedValueOnce({
      body: { error: 'aiNightModeEnabled requires the night window (nightStartTime/nightEndTime) in the AI triage config' },
    });
    await expect(result.current.definirNoturno('ch1', true)).rejects.toThrow(/Defina a janela noturna/);
  });

  test('salvarWaba e salvarNome: o valor recebido vai à API; validação em inglês não chega à tela', async () => {
    const refresh = vi.fn();
    api.setChannelWabaId.mockResolvedValue({});
    const { result } = renderHook(() => useChannelActions(refresh));
    await act(() => result.current.salvarWaba('ch1', 'waba-ficticio'));
    expect(api.setChannelWabaId).toHaveBeenCalledWith('ch1', 'waba-ficticio', 'tok-123');
    api.setChannelName.mockRejectedValue({ body: { error: 'name must be 120 characters or fewer' } });
    await expect(result.current.salvarNome('ch1', 'x'.repeat(121))).rejects.toThrow('Use no máximo 120 caracteres no nome do canal.');
    api.setChannelName.mockRejectedValue({ body: { error: 'Some unexpected validation failed' } });
    await expect(result.current.salvarNome('ch1', 'Canal')).rejects.toThrow('Não foi possível salvar o nome. Tente novamente.');
  });

  test('salvarCredenciaisMeta: mesmo payload, recarrega só no sucesso, e o motivo da Meta chega intacto', async () => {
    const refresh = vi.fn();
    const dados = { phoneNumberId: '000111', accessToken: 'token-ficticio', wabaId: '000222' };
    api.setMetaCloudCredentials.mockResolvedValueOnce({ id: 'ch1', type: 'meta_cloud' });
    const { result } = renderHook(() => useChannelActions(refresh));
    await act(async () => { expect(await result.current.salvarCredenciaisMeta('ch1', dados)).toEqual({ id: 'ch1', type: 'meta_cloud' }); });
    expect(api.setMetaCloudCredentials).toHaveBeenCalledWith('ch1', dados, 'tok-123');
    expect(refresh).toHaveBeenCalledTimes(1);
    api.setMetaCloudCredentials.mockRejectedValueOnce({ body: { error: 'A Meta recusou o Access Token: sessão expirada.' } });
    await expect(result.current.salvarCredenciaisMeta('ch1', dados)).rejects.toThrow('A Meta recusou o Access Token: sessão expirada.');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('useChannelActions: ações do canal', () => {
  test('reconectar um canal aguardando QR não pergunta: andamento no canal, API, recarga e conclusão', async () => {
    const pedido = adiado();
    api.reconnectChannel.mockReturnValue(pedido.promessa);
    const { ref, refresh, aoConcluir } = montarPalco();
    act(() => ref.atual.pedir('reconectar', aguardando));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(ref.atual.pendentes.ch2).toBe('Reconectando…');
    act(() => ref.atual.pedir('reconectar', aguardando));
    expect(api.reconnectChannel).toHaveBeenCalledTimes(1);
    await act(async () => { pedido.resolver({}); });
    expect(api.reconnectChannel).toHaveBeenCalledWith('ch2', 'tok-123');
    expect(ref.atual.pendentes.ch2).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(aoConcluir).toHaveBeenCalledWith('reconectar', aguardando);
  });

  test('reconectar direto que falha: o erro fica no canal, com repetir', async () => {
    api.reconnectChannel.mockRejectedValueOnce({ status: 500, body: { error: 'Internal failed' } });
    const { ref, aoConcluir } = montarPalco();
    await act(async () => { ref.atual.pedir('reconectar', aguardando); });
    expect(ref.atual.erros.ch2.mensagem).toBe('Não foi possível reconectar o canal. Tente novamente.');
    expect(aoConcluir).not.toHaveBeenCalled();
    api.reconnectChannel.mockResolvedValueOnce({});
    await act(async () => { ref.atual.erros.ch2.repetir(); });
    expect(api.reconnectChannel).toHaveBeenCalledTimes(2);
    expect(ref.atual.erros.ch2).toBeUndefined();
    expect(aoConcluir).toHaveBeenCalledWith('reconectar', aguardando);
  });

  test('excluir pede confirmação e só chama a API no botão; a confirmação espera a resposta', async () => {
    const pedido = adiado();
    api.deleteChannel.mockReturnValue(pedido.promessa);
    const { ref, refresh, aoConcluir } = montarPalco();
    act(() => ref.atual.pedir('excluir', conectado));
    const dialogo = screen.getByRole('alertdialog');
    expect(api.deleteChannel).not.toHaveBeenCalled();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Excluir canal' }));
    expect(api.deleteChannel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Excluindo…' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(ref.atual.pendentes.ch1).toBe('Excluindo canal…');
    act(() => ref.atual.pedir('ocultar', conectado));
    expect(api.setChannelHidden).not.toHaveBeenCalled();
    expect(aoConcluir).not.toHaveBeenCalled();
    await act(async () => { pedido.resolver({}); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(aoConcluir).toHaveBeenCalledWith('excluir', conectado);
  });

  test('409 ao excluir: a confirmação explica e oferece ocultar em vez de excluir', async () => {
    api.deleteChannel.mockRejectedValue({ status: 409, body: { error: 'Canal tem conversas vinculadas' } });
    api.setChannelHidden.mockResolvedValue({});
    const { ref, aoConcluir } = montarPalco();
    act(() => ref.atual.pedir('excluir', conectado));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir canal' }));
    const dialogo = screen.getByRole('alertdialog');
    expect(within(dialogo).getByRole('alert')).toHaveTextContent('não pode ser excluído sem perder esse histórico');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Ocultar em vez de excluir' }));
    expect(api.setChannelHidden).toHaveBeenCalledWith('ch1', true, 'tok-123');
    expect(aoConcluir).toHaveBeenCalledWith('ocultar', conectado);
  });

  test('ocultar e reexibir usam a mesma API de antes', async () => {
    api.setChannelHidden.mockResolvedValue({});
    const { ref } = montarPalco();
    act(() => ref.atual.pedir('reexibir', { ...conectado, hidden: true }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reexibir canal' }));
    expect(api.setChannelHidden).toHaveBeenCalledWith('ch1', false, 'tok-123');
  });
});
