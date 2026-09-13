import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AiTriageConfigCard from './AiTriageConfigCard';

vi.mock('../services/api');
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

import { getAiConfig, listReasons, updateAiTriageConfig } from '../services/api';

describe('AiTriageConfigCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Valores diferentes dos defaults do useState (80% / 2 / 3 minutos, o
    // default do banco) — se o useEffect de carregamento fosse removido,
    // estes testes falhariam em vez de passar por coincidência com o default.
    getAiConfig.mockResolvedValue({
      configured: true,
      triageConfidenceThreshold: 0.65,
      triageMaxQuestions: 4,
      triageTimeoutMinutes: 12,
      triageExtraInstructions: 'Pergunte o CPF antes de tudo',
      triageResolvedReasonId: null,
    });
    listReasons.mockResolvedValue([
      { id: 'r-1', name: 'Segunda via', active: true },
      { id: 'r-2', name: 'Resolvido pela IA', active: true },
    ]);
  });

  test('carrega os valores salvos (65 / 4 / 12)', async () => {
    render(<AiTriageConfigCard />);
    expect(await screen.findByDisplayValue('65')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pergunte o CPF antes de tudo')).toBeInTheDocument();
  });

  test('salva convertendo 85 (%) para 0.85', async () => {
    updateAiTriageConfig.mockResolvedValue({});
    render(<AiTriageConfigCard />);

    const confidenceInput = await screen.findByDisplayValue('65');
    await userEvent.clear(confidenceInput);
    await userEvent.type(confidenceInput, '85');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(updateAiTriageConfig).toHaveBeenCalledWith(
      {
        triageConfidenceThreshold: 0.85,
        triageMaxQuestions: 4,
        triageTimeoutMinutes: 12,
        triageExtraInstructions: 'Pergunte o CPF antes de tudo',
        triageResolvedReasonId: null,
        // Config sem janela: os campos nascem com o padrão da spec, e é ele
        // que vai para o banco quando o admin salva sem mexer neles.
        nightStartTime: '20:00',
        nightEndTime: '08:00',
      },
      't'
    ));
  });

  test('mostra o erro devolvido pelo backend', async () => {
    updateAiTriageConfig.mockRejectedValue({ body: { error: 'triageMaxQuestions must be an integer from 0 to 5' } });
    render(<AiTriageConfigCard />);

    await screen.findByDisplayValue('65');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByText(/triageMaxQuestions must be an integer from 0 to 5/i)).toBeInTheDocument();
  });

  test('lista os motivos cadastrados no select de encerramento pela IA', async () => {
    render(<AiTriageConfigCard />);
    const select = await screen.findByLabelText(/encerrar sozinha/i);
    expect(await screen.findByRole('option', { name: 'Resolvido pela IA' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Segunda via' })).toBeInTheDocument();
    // Vazio é o padrão: sem motivo, a conversa vai para a fila como hoje.
    expect(select).toHaveValue('');
  });

  test('salva o motivo escolhido e volta a null quando o admin limpa', async () => {
    updateAiTriageConfig.mockResolvedValue({});
    render(<AiTriageConfigCard />);

    const select = await screen.findByLabelText(/encerrar sozinha/i);
    await screen.findByRole('option', { name: 'Resolvido pela IA' });
    await userEvent.selectOptions(select, 'r-2');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(updateAiTriageConfig).toHaveBeenCalledWith(
      expect.objectContaining({ triageResolvedReasonId: 'r-2' }), 't'
    ));

    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(updateAiTriageConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ triageResolvedReasonId: null }), 't'
    ));
  });

  describe('janela do atendimento noturno', () => {
    test('carrega a janela salva e a manda de volta ao gravar', async () => {
      getAiConfig.mockResolvedValue({
        configured: true,
        triageConfidenceThreshold: 0.65,
        triageMaxQuestions: 4,
        triageTimeoutMinutes: 12,
        triageExtraInstructions: 'Pergunte o CPF antes de tudo',
        triageResolvedReasonId: null,
        nightStartTime: '20:00',
        nightEndTime: '08:00',
      });
      updateAiTriageConfig.mockResolvedValue({});
      render(<AiTriageConfigCard />);

      expect(await screen.findByLabelText(/atendimento noturno com ia — início/i)).toHaveValue('20:00');
      expect(screen.getByLabelText(/atendimento noturno com ia — fim/i)).toHaveValue('08:00');

      await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
      await waitFor(() => expect(updateAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ nightStartTime: '20:00', nightEndTime: '08:00' }), 't'
      ));
    });

    test('salva a janela preenchida pelo admin', async () => {
      updateAiTriageConfig.mockResolvedValue({});
      render(<AiTriageConfigCard />);

      const inicio = await screen.findByLabelText(/atendimento noturno com ia — início/i);
      await userEvent.clear(inicio);
      await userEvent.type(inicio, '19:30');
      const fim = screen.getByLabelText(/atendimento noturno com ia — fim/i);
      await userEvent.clear(fim);
      await userEvent.type(fim, '07:00');
      await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

      await waitFor(() => expect(updateAiTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ nightStartTime: '19:30', nightEndTime: '07:00' }), 't'
      ));
    });

    test('recusa meia janela: só o início preenchido', async () => {
      render(<AiTriageConfigCard />);

      await screen.findByLabelText(/atendimento noturno com ia — início/i);
      await userEvent.clear(screen.getByLabelText(/atendimento noturno com ia — fim/i));
      await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

      expect(await screen.findByText('Informe início e fim do atendimento noturno, ou deixe os dois vazios')).toBeInTheDocument();
      expect(updateAiTriageConfig).not.toHaveBeenCalled();
    });

    // Revisão final do branch: a config saía do banco sem janela (os dois
    // campos NULL) e o cartão mostrava dois campos vazios — o admin ligava o
    // interruptor no canal achando que bastava, e o modo noturno nunca ativava.
    test('config sem janela: os campos nascem no padrão da spec (20:00 / 08:00)', async () => {
      render(<AiTriageConfigCard />);
      expect(await screen.findByLabelText(/atendimento noturno com ia — início/i)).toHaveValue('20:00');
      expect(screen.getByLabelText(/atendimento noturno com ia — fim/i)).toHaveValue('08:00');
    });

    test('o texto de ajuda avisa que a janela precisa ser salva antes de ligar o canal', async () => {
      render(<AiTriageConfigCard />);
      expect(await screen.findByText(/salve a janela antes de ligar/i)).toBeInTheDocument();
    });
  });
});
