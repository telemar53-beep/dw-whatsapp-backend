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
  await userEvent.click(screen.getByRole('button', { name: /^equipe/i }));
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

    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByText('1 online')).toBeInTheDocument();
  });

  test('clicar em "Equipe" abre o painel e busca a lista de novo', async () => {
    const refresh = vi.fn();
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }], { refresh });
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    await openPanel();

    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nossa equipe' })).toBeInTheDocument();
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
    expect(screen.getByText('Disponíveis para atender')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Offline (2)' })).toBeInTheDocument();
    expect(screen.getByText('Não disponíveis no momento')).toBeInTheDocument();
    expect(screen.getByText('4 integrantes na equipe')).toBeInTheDocument();
    expect(screen.getByText('2 online • 1 em atendimento • 2 offline')).toBeInTheDocument();
  });

  test('atendente online mostra a contagem de atendimentos e o chip certo', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null, activeConversations: 1 },
      { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByText('Atendendo 1 conversa')).toBeInTheDocument();
    expect(screen.getByText('Disponível para atender')).toBeInTheDocument();
    // "Em atendimento" aparece no chip da Ana e no botão de filtro.
    expect(screen.getAllByText('Em atendimento')).toHaveLength(2);
    expect(screen.getByText('Disponível')).toBeInTheDocument();
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
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument();
  });

  test('o popup mostra o nome completo', async () => {
    agentsReady([{ id: 'a1', name: 'Agnieska Amorim Cutrim', avatarPath: null }]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByText('Agnieska Amorim Cutrim')).toBeInTheDocument();
  });

  test('a busca filtra por nome, sem acento', async () => {
    agentsReady([
      { id: 'a1', name: 'Agnieska Amorim', avatarPath: null },
      { id: 'a2', name: 'José', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    await userEvent.type(screen.getByRole('searchbox', { name: /buscar um integrante/i }), 'jose');

    expect(screen.getByText('José')).toBeInTheDocument();
    expect(screen.queryByText('Agnieska Amorim')).not.toBeInTheDocument();
  });

  test('os filtros mostram a contagem e restringem a lista', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null, activeConversations: 1 },
      { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 },
      { id: 'a3', name: 'Carla', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByRole('button', { name: 'Todos 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Online 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Offline 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Em atendimento 1' }));

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
    expect(screen.queryByText('Carla')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /offline/i })).not.toBeInTheDocument();
  });

  test('"Fechar" e o X fecham o popup', async () => {
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar o popup da equipe' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
