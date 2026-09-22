import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferModal, { loadLevel } from './TransferModal';
import { useAuth } from '../contexts/AuthContext';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1' } });
  usePresence.mockReturnValue(new Set());
  useAgents.mockReturnValue({
    agents: [
      { id: 'agent-1', email: 'me@dw.com', role: 'agent' },
      { id: 'agent-2', email: 'other@dw.com', role: 'agent' },
    ],
    status: 'ready',
  });
});

describe('TransferModal', () => {
  test('lists every agent except myself', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.queryByText('me@dw.com')).not.toBeInTheDocument();
    expect(screen.getByText('other@dw.com')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transferir atendimento' })).toBeInTheDocument();
  });

  test('selecting an agent transfers the conversation and closes the modal', async () => {
    api.transferConversation.mockResolvedValue({});
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);

    // A transferencia virou dois passos: escolher a linha e confirmar no
    // rodape, para nao repetir um botao identico por atendente.
    await userEvent.click(screen.getByRole('radio', { name: /other@dw.com/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Transferir para/ }));

    await waitFor(() => expect(api.transferConversation).toHaveBeenCalledWith('c1', 'agent-2', 'tok-123'));
    expect(onClose).toHaveBeenCalled();
  });

  test('shows the backend error inline and keeps the modal open when the transfer fails', async () => {
    api.transferConversation.mockRejectedValue({ body: { error: 'Agent is not online' } });
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);

    // A transferencia virou dois passos: escolher a linha e confirmar no
    // rodape, para nao repetir um botao identico por atendente.
    await userEvent.click(screen.getByRole('radio', { name: /other@dw.com/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Transferir para/ }));

    expect(await screen.findByText('Agent is not online')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('clicking the cancel button closes the modal without transferring', async () => {
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalled();
    expect(api.transferConversation).not.toHaveBeenCalled();
  });

  test('em carregamento não mostra "Nenhum outro atendente disponível"', () => {
    useAgents.mockReturnValue({ agents: [], status: 'loading' });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.queryByText(/nenhum outro atendente disponível/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('mostra nome, chip de carga e contagem de atendimentos por atendente', () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'Agnieska Amorim', email: 'a@dw.com', activeConversations: 0 },
        { id: 'agent-3', name: 'Pedro Henrique', email: 'p@dw.com', activeConversations: 15 },
        { id: 'agent-4', name: 'Berg', email: 'b@dw.com', activeConversations: 0 },
      ],
      status: 'ready',
    });
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Agnieska Amorim')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Disponível')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Atendendo normalmente')).toBeInTheDocument();

    expect(within(rows[1]).getByText('Pedro Henrique')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Carga alta')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Alta carga de atendimentos')).toBeInTheDocument();
    expect(within(rows[1]).getByText('15')).toBeInTheDocument();

    expect(within(rows[2]).getByText('Berg')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Offline')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Não está disponível no momento')).toBeInTheDocument();
  });

  test('ordena por menor carga (online primeiro) e, se pedido, por nome', async () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'Zilda', email: 'z@dw.com', activeConversations: 1 },
        { id: 'agent-3', name: 'Ana', email: 'a@dw.com', activeConversations: 7 },
        { id: 'agent-4', name: 'Beto', email: 'b@dw.com', activeConversations: 0 },
      ],
      status: 'ready',
    });
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    const names = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.truncate').textContent);
    expect(names()).toEqual(['Zilda', 'Ana', 'Beto']);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ordenar por' }), 'name');

    expect(names()).toEqual(['Ana', 'Beto', 'Zilda']);
  });

  test('a busca filtra por nome, sem acento', async () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'José', email: 'j@dw.com' },
        { id: 'agent-3', name: 'Ana', email: 'a@dw.com' },
      ],
      status: 'ready',
    });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox', { name: /buscar atendente/i }), 'jose');

    expect(screen.getByText('José')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });
});

describe('loadLevel', () => {
  test('offline nunca é sugerido como disponível', () => {
    expect(loadLevel({ online: false, active: 0 }).label).toBe('Offline');
  });

  test('escala pela quantidade de atendimentos abertos', () => {
    expect(loadLevel({ online: true, active: 0 }).label).toBe('Disponível');
    expect(loadLevel({ online: true, active: 4 }).label).toBe('Em atendimento');
    expect(loadLevel({ online: true, active: 5 }).label).toBe('Movimentado');
    expect(loadLevel({ online: true, active: 10 }).label).toBe('Carga alta');
    expect(loadLevel({ online: true, active: 10 }).alert).toBe(true);
  });
});
