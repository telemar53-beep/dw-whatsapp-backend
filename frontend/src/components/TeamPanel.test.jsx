import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamPanel from './TeamPanel';
import { useAgents } from '../hooks/useAgents';
import { usePresence } from '../hooks/usePresence';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence');
vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');

function agentsReady(agents, extra = {}) {
  useAgents.mockReturnValue({ agents, status: 'ready', refresh: vi.fn(), ...extra });
}

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: /equipe/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(null);
});

describe('TeamPanel', () => {
  test('começa fechado: só o cabeçalho "Equipe" aparece', () => {
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    expect(screen.getByRole('button', { name: /equipe/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByText('1 online')).toBeInTheDocument();
  });

  test('clicar em "Equipe" abre o painel e busca a lista de novo', async () => {
    const refresh = vi.fn();
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }], { refresh });
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    await openPanel();

    expect(screen.getByRole('button', { name: /equipe/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  test('shows a message when there are no agents', async () => {
    agentsReady([]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();
    expect(screen.getByText(/nenhum atendente cadastrado/i)).toBeInTheDocument();
  });

  test('em carregamento não mostra "Nenhum atendente"', async () => {
    useAgents.mockReturnValue({ agents: [], status: 'loading', refresh: vi.fn() });
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();
    expect(screen.queryByText(/nenhum atendente/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('lists online agents before offline agents, alphabetically within each group', async () => {
    agentsReady([
      { id: 'a1', name: 'Carlos', avatarPath: null },
      { id: 'a2', name: 'Ana', avatarPath: null },
      { id: 'a3', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    const items = screen.getAllByRole('listitem').map((li) => li.querySelector('.truncate').textContent);
    expect(items).toEqual(['Ana', 'Carlos', 'Bruno']);
  });

  test('separa em seções Online e Offline com contagem e resumo', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null, activeConversations: 1 },
      { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 },
      { id: 'a3', name: 'Carla', avatarPath: null },
      { id: 'a4', name: 'Davi', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByRole('heading', { name: 'Online (2)' })).toBeInTheDocument();
    expect(screen.getByText('1 disponível')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Offline (2)' })).toBeInTheDocument();
    expect(screen.getByText('2 indisponíveis')).toBeInTheDocument();
  });

  test('atendente online mostra a contagem de atendimentos e o chip certo', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null, activeConversations: 1 },
      { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByText('1 atendimento')).toBeInTheDocument();
    expect(screen.getByText('0 atendimentos')).toBeInTheDocument();
    expect(screen.getByText('Em atendimento')).toBeInTheDocument();
    // "Disponível" aparece na linha de status dos dois e no chip do Bruno.
    expect(screen.getAllByText('Disponível')).toHaveLength(3);
  });

  test('atendente offline mostra a última atividade', async () => {
    const today = new Date();
    today.setHours(8, 37, 0, 0);
    agentsReady([
      { id: 'a1', name: 'Berg', avatarPath: null, lastSeenAt: today.toISOString() },
      { id: 'a2', name: 'Willemberg', avatarPath: null, lastSeenAt: null },
    ]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByText('Última atividade: hoje às 08:37')).toBeInTheDocument();
    expect(screen.getByText('Última atividade: sem registro')).toBeInTheDocument();
    expect(screen.queryByText('Em atendimento')).not.toBeInTheDocument();
  });

  test('mostra só o primeiro nome, com o nome completo no title', async () => {
    agentsReady([{ id: 'a1', name: 'Agnieska Amorim Cutrim', avatarPath: null }]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByText('Agnieska')).toBeInTheDocument();
    expect(screen.queryByText('Agnieska Amorim Cutrim')).not.toBeInTheDocument();
    expect(screen.getByTitle('Agnieska Amorim Cutrim')).toBeInTheDocument();
  });

  test('shows an online dot for a connected agent and an offline dot for a disconnected one', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null },
      { id: 'a2', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByTitle('Online')).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toBeInTheDocument();
  });

  test("shows each teammate's avatar", async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: 'avatars/a1.jpg' },
      { id: 'a2', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  test('busca a lista de novo quando um atendimento é assumido ou encerrado', () => {
    const refresh = vi.fn();
    const handlers = {};
    useSocket.mockReturnValue({
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
      off: vi.fn(),
    });
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }], { refresh });
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);

    handlers['conversation:assigned']();
    handlers['conversation:closed']();

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
