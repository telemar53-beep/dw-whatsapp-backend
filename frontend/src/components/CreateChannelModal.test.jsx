import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateChannelModal from './CreateChannelModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateChannelModal', () => {
  test('shows both channel type options first, no form fields yet', () => {
    render(<CreateChannelModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByRole('button', { name: /baileys/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /meta cloud/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^nome/i)).not.toBeInTheDocument();
  });

  test('choosing Baileys shows only the baileys fields', async () => {
    render(<CreateChannelModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /baileys/i }));

    expect(screen.getByLabelText(/^nome/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/telefone/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();
  });

  test('choosing Meta Cloud shows the meta_cloud fields', async () => {
    render(<CreateChannelModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /meta cloud/i }));

    expect(screen.getByLabelText(/phone number id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/waba id/i)).toBeInTheDocument();
  });

  test('clicking Voltar returns to the type-choice step', async () => {
    render(<CreateChannelModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /baileys/i }));
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));

    expect(screen.getByRole('button', { name: /baileys/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^nome/i)).not.toBeInTheDocument();
  });

  test('creating a channel calls onCreated', async () => {
    api.createChannel.mockResolvedValue({ id: 'ch1' });
    const onCreated = vi.fn();
    render(<CreateChannelModal onClose={vi.fn()} onCreated={onCreated} />);

    await userEvent.click(screen.getByRole('button', { name: /baileys/i }));
    await userEvent.type(screen.getByLabelText(/^nome/i), 'Vendas');
    await userEvent.type(screen.getByLabelText(/telefone/i), '+5511988887777');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  test('canceling the form closes the whole modal', async () => {
    const onClose = vi.fn();
    render(<CreateChannelModal onClose={onClose} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /baileys/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
