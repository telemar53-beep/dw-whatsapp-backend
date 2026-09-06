import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartConversationModal from './StartConversationModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('StartConversationModal', () => {
  test('lists only connected Baileys channels', async () => {
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' },
      { id: 'ch-2', type: 'baileys', name: 'Desconectado', status: 'awaiting_qr' },
      { id: 'ch-3', type: 'meta_cloud', name: 'Oficial', status: 'connected' },
    ]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Desconectado')).not.toBeInTheDocument();
    expect(screen.queryByText('Oficial')).not.toBeInTheDocument();
  });

  test('shows a message when there is no eligible channel', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/nenhum canal baileys conectado/i)).toBeInTheDocument();
  });

  test('submits the form and calls onCreated with the new conversation', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockResolvedValue({ id: 'conv-new' });
    const onCreated = vi.fn();
    render(<StartConversationModal onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '5598999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi, tudo bem?');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    await waitFor(() =>
      expect(api.startConversation).toHaveBeenCalledWith(
        { channelId: 'ch-1', phoneNumber: '5598999990000', content: 'Oi, tudo bem?' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'conv-new' });
  });

  test('shows an error and keeps the modal open when the API rejects', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.startConversation.mockRejectedValue({ body: { error: 'Já existe um atendimento em andamento' } });
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);

    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/telefone/i), '5598999990000');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /iniciar/i }));

    expect(await screen.findByText('Já existe um atendimento em andamento')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('calls onClose when Cancelar is clicked', async () => {
    api.listChannelsForAgent.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<StartConversationModal onClose={onClose} onCreated={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('shows a loading message before the channel fetch resolves', () => {
    let resolvePromise;
    api.listChannelsForAgent.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByText(/carregando canais/i)).toBeInTheDocument();
    resolvePromise([]);
  });

  test('shows a distinct error message when the channel fetch fails, not the empty-list message', async () => {
    api.listChannelsForAgent.mockRejectedValue(new Error('network error'));
    render(<StartConversationModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(await screen.findByText(/não foi possível carregar os canais/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum canal baileys conectado/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iniciar/i })).toBeDisabled();
  });
});
