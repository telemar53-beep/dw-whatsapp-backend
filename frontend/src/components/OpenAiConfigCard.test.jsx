import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import OpenAiConfigCard from './OpenAiConfigCard';

vi.mock('../services/api');
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

import { getAiConfig, updateAiConfig, testAiConnection } from '../services/api';

describe('OpenAiConfigCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiConfig.mockResolvedValue({ configured: true, apiKeyLast4: 'abcd', model: 'gpt-x', mode: 'assistant' });
  });

  test('shows only the last four characters of the saved key', async () => {
    render(<OpenAiConfigCard />);
    expect(await screen.findByText(/abcd/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/sk-/)).not.toBeInTheDocument();
  });

  test('shows the integration status', async () => {
    render(<OpenAiConfigCard />);
    expect(await screen.findByText('Conectada')).toBeInTheDocument();
  });

  test('shows Desativada when the mode is disabled', async () => {
    getAiConfig.mockResolvedValue({ configured: true, apiKeyLast4: 'abcd', model: 'gpt-x', mode: 'disabled' });
    render(<OpenAiConfigCard />);
    expect(await screen.findByText('Desativada')).toBeInTheDocument();
  });

  test('testing the connection fills the model list', async () => {
    testAiConnection.mockResolvedValue({ ok: true, models: ['gpt-a', 'gpt-b'] });
    render(<OpenAiConfigCard />);
    await userEvent.click(await screen.findByRole('button', { name: /testar conexão/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'gpt-a' })).toBeInTheDocument());
  });

  test('a failed test shows the error and does not save', async () => {
    testAiConnection.mockResolvedValue({ ok: false, error: 'chave inválida' });
    render(<OpenAiConfigCard />);
    await userEvent.click(await screen.findByRole('button', { name: /testar conexão/i }));
    expect(await screen.findByText(/chave inválida/)).toBeInTheDocument();
    expect(updateAiConfig).not.toHaveBeenCalled();
  });
});
