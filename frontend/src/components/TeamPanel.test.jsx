import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// O popup chega sob demanda: depois do clique, espera o diálogo existir.
async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: /^equipe/i }));
  return screen.findByRole('dialog', { name: 'Nossa equipe' });
}

const nomesNaOrdem = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.eq-nome').textContent);

function largura(px) {
  vi.stubGlobal('matchMedia', (consulta) => {
    const max = /max-width:\s*(\d+)px/.exec(consulta);
    return { matches: Boolean(max) && px <= Number(max[1]), media: consulta, addEventListener() {}, removeEventListener() {} };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  useSocket.mockReturnValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('TeamPanel', () => {
  // No trilho, o "1 online" que a barra mostrava vai para o nome do botão.
  test('começa fechado: só o botão "Equipe", com quantos estão online', () => {
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);

    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAccessibleName('Equipe: 1 online');
  });

  // A carga só é pedida com o popup aberto: fechado, o botão usa a lista só
  // para contar quem está online. Buscar (ou não) é decisão do provedor, que
  // sabe se a lista está atual (AgentsContext.carga.test.jsx).
  test('clicar em "Equipe" abre o painel e passa a pedir a carga atual — fechado, não pede', async () => {
    const refresh = vi.fn();
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }], { refresh });
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);
    expect(useAgents).toHaveBeenLastCalledWith({ carga: false });

    const dialogo = await openPanel();

    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialogo).getByRole('heading', { name: 'Nossa equipe' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(useAgents).toHaveBeenLastCalledWith({ carga: true });
    // Abrir não força busca: com a lista atual, nenhuma requisição.
    expect(refresh).not.toHaveBeenCalled();
  });

  test('claro e sem o portal a mais: o diálogo vai direto para o body, sem "×"', async () => {
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    const dialogo = await openPanel();
    expect(dialogo).toHaveClass('mc');
    expect(dialogo.parentElement.parentElement).toBe(document.body);
    expect(document.querySelector('[data-dialog-close]')).toBeNull();
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
    expect(screen.getByRole('status')).toHaveTextContent('Carregando a equipe…');
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

    expect(nomesNaOrdem()).toEqual(['Ana', 'Carlos', 'Bruno']);
  });

  test('separa atendentes ocupados, disponíveis e offline com contagem', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null, activeConversations: 1 },
      { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 },
      { id: 'a3', name: 'Carla', avatarPath: null },
      { id: 'a4', name: 'Davi', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    const dialogo = await openPanel();

    expect(screen.getByRole('heading', { name: 'Em atendimento 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Disponíveis 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Offline 2' })).toBeInTheDocument();
    expect(dialogo).toHaveAccessibleDescription('4 integrantes na equipe, 2 online agora');
    expect(screen.getByRole('button', { name: 'Online 2' })).toBeInTheDocument();
  });

  // A linha do Transferir, sem o rádio: presença escrita ao lado do ponto e a
  // carga numa coluna própria.
  test('cada atendente mostra presença por escrito e a carga ativa', async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: null, activeConversations: 1 },
      { id: 'a2', name: 'Bruno', avatarPath: null, activeConversations: 0 },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    const [ana, bruno] = screen.getAllByRole('listitem');
    expect(within(ana).getByText('Em atendimento', { selector: '.eq-presenca' })).toBeInTheDocument();
    expect(within(ana).getByText('1 atendimento ativo')).toBeInTheDocument();
    expect(within(bruno).getByText('Disponível', { selector: '.eq-presenca' })).toBeInTheDocument();
    expect(within(bruno).getByText('0 atendimentos ativos')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  test('atendente offline mostra a última atividade', async () => {
    const today = new Date();
    today.setHours(8, 37, 0, 0);
    agentsReady([
      { id: 'a1', name: 'Atendente B', avatarPath: null, lastSeenAt: today.toISOString() },
      { id: 'a2', name: 'Atendente C', avatarPath: null, lastSeenAt: null },
    ]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getByText('Última atividade: hoje às 08:37')).toBeInTheDocument();
    expect(screen.getByText('Última atividade: sem registro')).toBeInTheDocument();
    expect(screen.getAllByText('0 atendimentos ativos')).toHaveLength(2);
  });

  test('o popup mostra o nome completo', async () => {
    agentsReady([{ id: 'a1', name: 'Atendente Com Um Nome Bem Comprido Para Testar', avatarPath: null }]);
    usePresence.mockReturnValue(new Set(['a1']));
    render(<TeamPanel />);
    await openPanel();

    const nome = screen.getByText('Atendente Com Um Nome Bem Comprido Para Testar');
    expect(nome).toHaveAttribute('title', 'Atendente Com Um Nome Bem Comprido Para Testar');
  });

  test('a busca filtra por nome, sem acento', async () => {
    agentsReady([
      { id: 'a1', name: 'Atendente Ana', avatarPath: null },
      { id: 'a2', name: 'José', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set(['a1', 'a2']));
    render(<TeamPanel />);
    await openPanel();

    await userEvent.type(screen.getByRole('searchbox', { name: /buscar um integrante/i }), 'jose');

    expect(screen.getByText('José')).toBeInTheDocument();
    expect(screen.queryByText('Atendente Ana')).not.toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: 'Em atendimento 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
    expect(screen.queryByText('Carla')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /offline/i })).not.toBeInTheDocument();
  });

  test('desktop: "Fechar" fecha, Escape fecha e o foco volta ao botão "Equipe"', async () => {
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    const equipe = screen.getByRole('button', { name: /^equipe/i });
    await openPanel();
    expect(screen.getAllByRole('button', { name: 'Fechar' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(equipe).toHaveFocus();

    await openPanel();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(equipe).toHaveFocus();
  });

  test('celular: tela cheia com a seta de voltar e nenhum "Fechar"', async () => {
    largura(390);
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    const dialogo = await openPanel();
    expect(dialogo).toHaveClass('is-celular');
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
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

    const [ana, bruno] = screen.getAllByRole('listitem');
    expect(within(ana).getByText('Disponível').closest('.eq-presenca')).toHaveAttribute('data-tom', 'verde');
    expect(within(bruno).getByText('Offline').closest('.eq-presenca')).toHaveAttribute('data-tom', 'neutro');
  });

  test("shows each teammate's avatar", async () => {
    agentsReady([
      { id: 'a1', name: 'Ana', avatarPath: 'avatars/a1.jpg' },
      { id: 'a2', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();

    expect(screen.getAllByRole('img', { hidden: true })).toHaveLength(1);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  // Antes, o botão assinava os eventos de conversa e buscava /api/agents a
  // cada um, com o popup fechado. Agora quem ouve é o AgentsProvider, que só
  // marca a lista como desatualizada.
  test('o botão não assina eventos de conversa nem busca por causa deles', () => {
    const refresh = vi.fn();
    const socket = { on: vi.fn(), off: vi.fn() };
    useSocket.mockReturnValue(socket);
    agentsReady([{ id: 'a1', name: 'Ana', avatarPath: null }], { refresh });
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);

    expect(socket.on).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('Nossa equipe: carregando, erro e busca vazia', () => {
  test('erro: o botão diz, o popup não afirma "0 integrantes" e oferece "Tentar de novo" (ATD-EQP-04, ATD-EQM-07)', async () => {
    const refresh = vi.fn();
    useAgents.mockReturnValue({ agents: [], status: 'error', refresh });
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAccessibleName('Equipe: não foi possível carregar');
    await openPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a equipe.');
    expect(screen.queryByText(/0 integrantes/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('carregando: "Carregando a equipe…", sem contagem (ATD-EQM-01)', async () => {
    useAgents.mockReturnValue({ agents: [], status: 'loading', refresh: vi.fn() });
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    expect(screen.getByRole('button', { name: /^equipe/i })).toHaveAccessibleName('Equipe: carregando');
    await openPanel();
    expect(screen.getByText('Carregando a equipe…')).toBeInTheDocument();
    expect(screen.queryByText(/0 integrantes/)).not.toBeInTheDocument();
  });

  test('busca sem resultado diz o termo e oferece "Limpar busca" (ATD-EQM-09)', async () => {
    agentsReady([{ id: 'a1', name: 'Ana Lima', activeConversations: 0 }]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);
    await openPanel();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('Ninguém encontrado para "zzz".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });
});
