import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChannelWelcomeMessageRow from './ChannelWelcomeMessageRow';
import { useAuth } from '../../contexts/AuthContext';
import * as api from '../../services/api';

vi.mock('../../contexts/AuthContext');
vi.mock('../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ChannelWelcomeMessageRow', () => {
  test('a channel without a welcome message shows a create button, not an open textarea', () => {
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: null }} onSaved={vi.fn()} />);

    expect(screen.getByText('WhatsApp Vendas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /criar boas-vindas/i })).toBeInTheDocument();
    const channelRow = screen.getByText('WhatsApp Vendas').closest('li');
    expect(within(channelRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a channel with a welcome message shows a closed row with a preview and edit/delete buttons', () => {
    render(
      <ChannelWelcomeMessageRow
        channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Olá! Bem-vindo às vendas.' }}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByText('WhatsApp Vendas')).toBeInTheDocument();
    expect(screen.getByText('Olá! Bem-vindo às vendas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^excluir$/i })).toBeInTheDocument();
    const channelRow = screen.getByText('WhatsApp Vendas').closest('li');
    expect(within(channelRow).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('creating a welcome message opens the form, saves, and refreshes the channel list', async () => {
    const onSaved = vi.fn();
    api.setChannelWelcomeMessage.mockResolvedValue({ id: 'ch-1', welcomeMessage: 'Novo texto' });
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: null }} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: /criar boas-vindas/i }));
    // After clicking, the form appears with a textarea for editing
    const textareas = screen.getAllByRole('textbox');
    const welcomeTextarea = textareas.find(ta => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(welcomeTextarea, 'Novo texto');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => expect(api.setChannelWelcomeMessage).toHaveBeenCalledWith('ch-1', 'Novo texto', 'tok-123'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('editing an existing welcome message pre-fills the form with the current text', async () => {
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(screen.getByDisplayValue('Texto atual')).toBeInTheDocument();
  });

  test('canceling a welcome-message edit discards unsaved changes and shows the closed row again', async () => {
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const textarea = screen.getByDisplayValue('Texto atual');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Rascunho abandonado');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.getByText('Texto atual')).toBeInTheDocument();
    expect(screen.queryByText('Rascunho abandonado')).not.toBeInTheDocument();
  });

  test('deleting a welcome message asks for confirmation, then clears it via an empty string and refreshes', async () => {
    const onSaved = vi.fn();
    api.setChannelWelcomeMessage.mockResolvedValue({ id: 'ch-1', welcomeMessage: null });
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(api.setChannelWelcomeMessage).toHaveBeenCalledWith('ch-1', '', 'tok-123'));
    expect(onSaved).toHaveBeenCalled();
  });

  test('does not delete a welcome message when the confirmation is declined', async () => {
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancelar/i }));

    expect(api.setChannelWelcomeMessage).not.toHaveBeenCalled();
  });

  test('shows an error message when saving a welcome message fails', async () => {
    api.setChannelWelcomeMessage.mockRejectedValue({ body: { error: 'Falha ao salvar boas-vindas' } });
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: null }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /criar boas-vindas/i }));
    const textareas = screen.getAllByRole('textbox');
    const welcomeTextarea = textareas.find(ta => ta.tagName === 'TEXTAREA' && !ta.id);
    await userEvent.type(welcomeTextarea, 'Test text');
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(await screen.findByText('Falha ao salvar boas-vindas')).toBeInTheDocument();
  });

  test('shows an error message when deleting a welcome message fails', async () => {
    api.setChannelWelcomeMessage.mockRejectedValue({ body: { error: 'Falha ao excluir boas-vindas' } });
    render(<ChannelWelcomeMessageRow channel={{ id: 'ch-1', name: 'WhatsApp Vendas', welcomeMessage: 'Texto atual' }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^excluir$/i }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));

    expect(await screen.findByText('Falha ao excluir boas-vindas')).toBeInTheDocument();
  });
});
