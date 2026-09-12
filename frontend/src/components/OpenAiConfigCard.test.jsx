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

  test('first-time setup: testing the connection sends the freshly typed key', async () => {
    getAiConfig.mockResolvedValue({ configured: false, apiKeyLast4: null, model: '', mode: 'disabled' });
    testAiConnection.mockResolvedValue({ ok: true, models: ['gpt-a'] });
    render(<OpenAiConfigCard />);

    const keyInput = await screen.findByLabelText(/chave da api/i);
    await userEvent.type(keyInput, 'sk-fresh-key');
    await userEvent.click(screen.getByRole('button', { name: /testar conexão/i }));

    await waitFor(() => expect(testAiConnection).toHaveBeenCalledWith('sk-fresh-key', 't'));
  });

  test('first-time setup: saving sends the freshly typed key', async () => {
    getAiConfig.mockResolvedValue({ configured: false, apiKeyLast4: null, model: '', mode: 'disabled' });
    testAiConnection.mockResolvedValue({ ok: true, models: ['gpt-a'] });
    updateAiConfig.mockResolvedValue({});
    render(<OpenAiConfigCard />);

    const keyInput = await screen.findByLabelText(/chave da api/i);
    await userEvent.type(keyInput, 'sk-fresh-key');
    await userEvent.click(screen.getByRole('button', { name: /testar conexão/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'gpt-a' })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/modelo/i), 'gpt-a');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(updateAiConfig).toHaveBeenCalledWith({ apiKey: 'sk-fresh-key', model: 'gpt-a', mode: 'disabled' }, 't')
    );
  });

  test('a successful save clears a previous connection test error', async () => {
    testAiConnection.mockResolvedValue({ ok: false, error: 'falhou' });
    updateAiConfig.mockResolvedValue({});
    render(<OpenAiConfigCard />);

    await userEvent.click(await screen.findByRole('button', { name: /testar conexão/i }));
    expect(await screen.findByText(/falhou/)).toBeInTheDocument();
    expect(screen.getByText('Erro')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => expect(updateAiConfig).toHaveBeenCalled());
    expect(screen.queryByText(/falhou/)).not.toBeInTheDocument();
    expect(screen.queryByText('Erro')).not.toBeInTheDocument();
  });
});
