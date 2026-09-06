import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateQuickReplyForm from './CreateQuickReplyForm';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('CreateQuickReplyForm', () => {
  test('creates a quick reply and calls onCreated', async () => {
    api.createQuickReply.mockResolvedValue({ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' });
    const onCreated = vi.fn();
    render(<CreateQuickReplyForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText(/título/i), 'Boas-vindas');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Olá!');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() =>
      expect(api.createQuickReply).toHaveBeenCalledWith({ title: 'Boas-vindas', content: 'Olá!' }, 'tok-123')
    );
    expect(onCreated).toHaveBeenCalled();
  });

  test('shows an error message when creation fails', async () => {
    api.createQuickReply.mockRejectedValue({ body: { error: 'Falha ao cadastrar' } });
    render(<CreateQuickReplyForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/título/i), 'Boas-vindas');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Olá!');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    expect(await screen.findByText('Falha ao cadastrar')).toBeInTheDocument();
  });
});
