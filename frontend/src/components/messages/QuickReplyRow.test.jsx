import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickReplyRow from './QuickReplyRow';
import { useAuth } from '../../contexts/AuthContext';
import * as api from '../../services/api';

vi.mock('../../contexts/AuthContext');
vi.mock('../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('QuickReplyRow', () => {
  test('editing a quick reply calls updateQuickReply and refreshes', async () => {
    const onSaved = vi.fn();
    api.updateQuickReply.mockResolvedValue({ id: 'qr-1', title: 'Editado', content: 'Novo texto' });
    render(<QuickReplyRow quickReply={{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }} onSaved={onSaved} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const titleInput = screen.getByDisplayValue('Boas-vindas');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Olá!' }, 'tok-123')
    );
    expect(onSaved).toHaveBeenCalled();
  });

  test('canceling an edit discards unsaved changes', async () => {
    render(<QuickReplyRow quickReply={{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }} onSaved={vi.fn()} onDeleted={vi.fn()} />);

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
    const onDeleted = vi.fn();
    api.deleteQuickReply.mockResolvedValue(undefined);
    render(<QuickReplyRow quickReply={{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }} onSaved={vi.fn()} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.deleteQuickReply).toHaveBeenCalledWith('qr-1', 'tok-123'));
    expect(onDeleted).toHaveBeenCalled();
  });

  test('does not delete when the confirmation is declined', async () => {
    render(<QuickReplyRow quickReply={{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }} onSaved={vi.fn()} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancelar/i }));

    expect(api.deleteQuickReply).not.toHaveBeenCalled();
  });

  test('shows an error message when deleting fails', async () => {
    api.deleteQuickReply.mockRejectedValue({ body: { error: 'Falha ao excluir' } });
    render(<QuickReplyRow quickReply={{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }} onSaved={vi.fn()} onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByText('Falha ao excluir')).toBeInTheDocument();
  });
});
