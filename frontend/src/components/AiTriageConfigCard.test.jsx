import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AiTriageConfigCard from './AiTriageConfigCard';

vi.mock('../services/api');
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

import { getAiConfig, updateAiTriageConfig } from '../services/api';

describe('AiTriageConfigCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Valores diferentes dos defaults do useState (80% / 2 / 5 minutos) — se o
    // useEffect de carregamento fosse removido, estes testes falhariam em vez
    // de passar por coincidência com o default.
    getAiConfig.mockResolvedValue({
      configured: true,
      triageConfidenceThreshold: 0.65,
      triageMaxQuestions: 4,
      triageTimeoutMinutes: 12,
      triageExtraInstructions: 'Pergunte o CPF antes de tudo',
    });
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
});
