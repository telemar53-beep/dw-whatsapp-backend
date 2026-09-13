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
});
