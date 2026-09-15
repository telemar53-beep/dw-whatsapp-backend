import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import NightModePage from './NightModePage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useChannels } from '../../../hooks/useChannels';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../services/api');

const PATH = '/configuracoes/automacao/noturno';

const saved = {
  configured: true,
  triageConfidenceThreshold: 0.65,
  triageMaxQuestions: 4,
  triageTimeoutMinutes: 12,
  triageExtraInstructions: 'Pergunte o CPF antes de tudo',
  triageResolvedReasonId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 't', agent: { role: 'admin' } });
  useAiConfig.mockReturnValue({ config: saved, status: 'ready', loading: false, refresh: vi.fn() });
  useChannels.mockReturnValue({ channels: [], status: 'ready' });
  api.updateAiTriageConfig.mockResolvedValue({});
});

describe('NightModePage', () => {
  test('o botão diz o que salva', () => {
    renderInShell(<NightModePage />, { path: PATH });
    expect(screen.getByRole('button', { name: 'Salvar janela noturna' })).toBeInTheDocument();
  });

  test('carrega a janela salva e a manda de volta ao gravar', async () => {
    useAiConfig.mockReturnValue({ config: { ...saved, nightStartTime: '20:00', nightEndTime: '08:00' }, status: 'ready', loading: false, refresh: vi.fn() });
    renderInShell(<NightModePage />, { path: PATH });

    expect(screen.getByLabelText('Início')).toHaveValue('20:00');
    expect(screen.getByLabelText('Fim')).toHaveValue('08:00');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar janela noturna' }));
    await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
      expect.objectContaining({ nightStartTime: '20:00', nightEndTime: '08:00' }), 't'
    ));
  });

  test('salva a janela preenchida pelo admin', async () => {
    renderInShell(<NightModePage />, { path: PATH });

    const inicio = screen.getByLabelText('Início');
    await userEvent.clear(inicio);
    await userEvent.type(inicio, '19:30');
    const fim = screen.getByLabelText('Fim');
    await userEvent.clear(fim);
    await userEvent.type(fim, '07:00');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar janela noturna' }));

    await waitFor(() => expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
      expect.objectContaining({ nightStartTime: '19:30', nightEndTime: '07:00' }), 't'
    ));
  });

  test('recusa meia janela: só o início preenchido', async () => {
    renderInShell(<NightModePage />, { path: PATH });

    await userEvent.clear(screen.getByLabelText('Fim'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar janela noturna' }));

    expect(await screen.findByText('Informe início e fim do atendimento noturno, ou deixe os dois vazios')).toBeInTheDocument();
    expect(api.updateAiTriageConfig).not.toHaveBeenCalled();
  });

  // Revisão final do branch anterior: a config saía do banco sem janela (os
  // dois campos NULL) e o admin ligava o interruptor no canal achando que
  // bastava, e o modo noturno nunca ativava.
  test('config sem janela: os campos nascem no padrão da spec (20:00 / 08:00)', () => {
    renderInShell(<NightModePage />, { path: PATH });
    expect(screen.getByLabelText('Início')).toHaveValue('20:00');
    expect(screen.getByLabelText('Fim')).toHaveValue('08:00');
  });

  test('o texto de ajuda avisa que a janela precisa ser salva antes de ligar o canal', () => {
    renderInShell(<NightModePage />, { path: PATH });
    expect(screen.getByText(/salve a janela antes de ligar/i)).toBeInTheDocument();
  });

  test('mostra os canais com o noturno ligado', () => {
    useChannels.mockReturnValue({
      channels: [{ id: 'ch1', name: 'Berg', aiNightModeEnabled: true }, { id: 'ch2', name: 'Suporte', aiNightModeEnabled: false }],
      status: 'ready',
    });
    renderInShell(<NightModePage />, { path: PATH });
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Suporte')).not.toBeInTheDocument();
  });

  test('avisa quando nenhum canal tem o noturno ligado', () => {
    renderInShell(<NightModePage />, { path: PATH });
    expect(screen.getByText(/nenhum canal com o noturno ligado/i)).toBeInTheDocument();
  });
});
