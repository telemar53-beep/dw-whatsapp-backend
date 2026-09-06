import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickRepliesAdminTab from './QuickRepliesAdminTab';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('QuickRepliesAdminTab', () => {
  test('lists existing quick replies', () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<QuickRepliesAdminTab />);

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('Olá!')).toBeInTheDocument();
  });

  test('editing a quick reply calls updateQuickReply and refreshes', async () => {
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh,
    });
    api.updateQuickReply.mockResolvedValue({ id: 'qr-1', title: 'Editado', content: 'Novo texto' });
    render(<QuickRepliesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const titleInput = screen.getByDisplayValue('Boas-vindas');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Olá!' }, 'tok-123')
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('canceling an edit discards unsaved changes', async () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<QuickRepliesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const titleInput = screen.getByDisplayValue('Boas-vindas');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByDisplayValue('Boas-vindas')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a quick reply calls deleteQuickReply and refreshes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh,
    });
    api.deleteQuickReply.mockResolvedValue(undefined);
    render(<QuickRepliesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => expect(api.deleteQuickReply).toHaveBeenCalledWith('qr-1', 'tok-123'));
    expect(refresh).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      refresh: vi.fn(),
    });
    render(<QuickRepliesAdminTab />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));

    expect(api.deleteQuickReply).not.toHaveBeenCalled();
  });
});
