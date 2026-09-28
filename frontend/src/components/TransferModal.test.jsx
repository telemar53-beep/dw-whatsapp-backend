import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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

const AQUI = dirname(fileURLToPath(import.meta.url));

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
    refresh: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

// O jsdom não avalia media query: o diálogo decide o celular pela consulta.
function telaDeCelular() {
  vi.stubGlobal('matchMedia', (consulta) => ({ matches: /max-width/.test(consulta), media: consulta, addEventListener() {}, removeEventListener() {} }));
}

const nomes = () => screen.getAllByRole('radio').map((linha) => linha.querySelector('.tr-nome').textContent);

describe('TransferModal', () => {
  // A transferência mostra a carga e ordena por ela: pede a lista conferida
  // (AgentsContext.carga.test.jsx prova a busca, a espera e a ordem).
  test('pede a carga atual dos atendentes', () => {
    render(<TransferModal conversationId="conv-1" onClose={vi.fn()} />);
    expect(useAgents).toHaveBeenCalledWith({ carga: true });
  });

  test('lista todos os atendentes menos eu, com o título e a explicação do diálogo', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.queryByText('me@dw.com')).not.toBeInTheDocument();
    expect(screen.getByText('other@dw.com')).toBeInTheDocument();
    const dialogo = screen.getByRole('dialog', { name: 'Transferir atendimento' });
    expect(dialogo).toHaveAccessibleDescription('Escolha o atendente que continuará esta conversa.');
  });

  test('escolher um atendente e confirmar transfere a conversa e fecha o diálogo', async () => {
    api.transferConversation.mockResolvedValue({});
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);

    // Dois passos: escolher a linha e confirmar no rodapé.
    await userEvent.click(screen.getByRole('radio', { name: /other@dw.com/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Transferir para/ }));

    await waitFor(() => expect(api.transferConversation).toHaveBeenCalledWith('c1', 'agent-2', 'tok-123'));
    expect(onClose).toHaveBeenCalled();
  });

  test('sem ninguém escolhido, Transferir fica desabilitado', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Transferir' })).toBeDisabled();
  });

  test('clique duplo no Transferir envia uma vez só, e o botão diz que está transferindo', async () => {
    let concluir;
    api.transferConversation.mockImplementation(() => new Promise((r) => { concluir = r; }));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /other@dw.com/ }));
    const botao = screen.getByRole('button', { name: /^Transferir para/ });
    await userEvent.dblClick(botao);
    await userEvent.click(botao);
    expect(api.transferConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Transferindo…' })).toBeDisabled();
    concluir({});
  });

  test('a falha aparece no diálogo, que continua aberto, e tentar de novo transfere', async () => {
    api.transferConversation.mockRejectedValueOnce({ body: { error: 'Agent is not online' } }).mockResolvedValueOnce({});
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);

    await userEvent.click(screen.getByRole('radio', { name: /other@dw.com/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Transferir para/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent is not online');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /other@dw.com/ })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^Transferir para/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.transferConversation).toHaveBeenCalledTimes(2);
  });

  test('Cancelar fecha sem transferir', async () => {
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.transferConversation).not.toHaveBeenCalled();
  });

  test('carregando: nada de "Nenhum outro atendente" nem linha para escolher, só o aviso de carregamento', () => {
    useAgents.mockReturnValue({ agents: [], status: 'loading', refresh: vi.fn() });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.queryByText(/nenhum outro atendente disponível/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Conferindo a carga atual dos atendentes…');
  });

  test('a lista não carregou: erro e "Tentar de novo" pede outra vez', async () => {
    const refresh = vi.fn();
    useAgents.mockReturnValue({ agents: [], status: 'error', error: 'Sem conexão com o servidor.', refresh });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // A falha de uma atualização deixa os últimos dados (AgentsContext): eles
  // continuam na tela, mas não passam por atuais.
  test('a carga não pôde ser conferida: a lista fica, com o aviso de que é a última conhecida', async () => {
    const refresh = vi.fn();
    useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Eu' }, { id: 'agent-2', name: 'Ana', activeConversations: 3 }], status: 'ready', error: 'rede', refresh });
    usePresence.mockReturnValue(new Set(['agent-2']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Ana/ })).toHaveTextContent('3 atendimentos');
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conferir a carga agora. Os números são da última atualização.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('mostra nome, presença, contagem e descrição da carga de cada atendente', () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'Atendente Ana', email: 'a@dw.com', activeConversations: 0 },
        { id: 'agent-3', name: 'Atendente Pedro', email: 'p@dw.com', activeConversations: 15 },
        { id: 'agent-4', name: 'Atendente Beto', email: 'b@dw.com', activeConversations: 0 },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Atendente Ana')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Disponível')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Atendendo normalmente')).toBeInTheDocument();

    expect(within(rows[1]).getByText('Atendente Pedro')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Carga alta')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Alta carga de atendimentos')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('radio')).toHaveTextContent('15 atendimentos');

    expect(within(rows[2]).getByText('Atendente Beto')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Offline')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Não está disponível no momento')).toBeInTheDocument();
  });

  test('Disponíveis e Offline em seções com a contagem, na ordem de menor carga', () => {
    useAgents.mockReturnValue({
      agents: [{ id: 'agent-1', name: 'Eu' }, { id: 'agent-2', name: 'Ana', activeConversations: 2 }, { id: 'agent-3', name: 'Beto', activeConversations: 0 }],
      status: 'ready',
      refresh: vi.fn(),
    });
    usePresence.mockReturnValue(new Set(['agent-2']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Disponíveis, 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Offline, 1' })).toBeInTheDocument();
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
      refresh: vi.fn(),
    });
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    expect(nomes()).toEqual(['Zilda', 'Ana', 'Beto']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ordenar por' }), 'name');
    expect(nomes()).toEqual(['Ana', 'Beto', 'Zilda']);
  });

  test('a busca filtra por nome, sem acento', async () => {
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'José', email: 'j@dw.com' },
        { id: 'agent-3', name: 'Ana', email: 'a@dw.com' },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('searchbox', { name: /buscar atendente/i }), 'jose');

    expect(screen.getByText('José')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  test('busca sem resultado diz que ninguém tem esse nome', async () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar atendente/i }), 'zzz');
    expect(screen.getByText('Nenhum atendente encontrado com esse nome.')).toBeInTheDocument();
  });

  test('a escolha sobrevive à busca: o botão continua valendo e a nota diz quem está escolhido (A2-7)', async () => {
    api.transferConversation.mockResolvedValue({});
    useAgents.mockReturnValue({
      agents: [
        { id: 'agent-1', name: 'Eu', email: 'me@dw.com' },
        { id: 'agent-2', name: 'José', email: 'j@dw.com' },
        { id: 'agent-3', name: 'Ana', email: 'a@dw.com' },
      ],
      status: 'ready',
      refresh: vi.fn(),
    });
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar atendente/i }), 'jose');
    expect(screen.getByText('Escolhido: Ana (fora da busca).')).toBeInTheDocument();
    const botao = screen.getByRole('button', { name: /^Transferir para/ });
    expect(botao).toBeEnabled();
    await userEvent.click(botao);
    await waitFor(() => expect(api.transferConversation).toHaveBeenCalledWith('c1', 'agent-3', 'tok-123'));
  });
});

describe('TransferModal: teclado e foco', () => {
  const tres = {
    agents: [{ id: 'agent-1', name: 'Eu' }, { id: 'agent-2', name: 'Ana', activeConversations: 1 }, { id: 'agent-3', name: 'Beto', activeConversations: 2 }, { id: 'agent-4', name: 'Caio', activeConversations: 3 }],
    status: 'ready',
    refresh: vi.fn(),
  };

  test('no desktop o foco começa na busca', () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: /buscar atendente/i })).toHaveFocus();
  });

  test('Escape fecha', async () => {
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a lista é um grupo de rádio: um só ponto de Tab, setas andam e escolhem, Home e End vão às pontas', async () => {
    useAgents.mockReturnValue(tres);
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3', 'agent-4']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    const linhas = screen.getAllByRole('radio');
    expect(linhas.map((l) => l.tabIndex)).toEqual([0, -1, -1]);

    linhas[0].focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(linhas[1]).toHaveFocus();
    expect(linhas[1]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio').map((l) => l.tabIndex)).toEqual([-1, 0, -1]);

    await userEvent.keyboard('{End}');
    expect(linhas[2]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(linhas[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(linhas[2]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(linhas[0]).toHaveAttribute('aria-checked', 'true');
  });

  test('Enter e Espaço escolhem a linha com foco', async () => {
    useAgents.mockReturnValue(tres);
    usePresence.mockReturnValue(new Set(['agent-2', 'agent-3', 'agent-4']));
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    const linhas = screen.getAllByRole('radio');
    linhas[0].focus();
    await userEvent.keyboard(' ');
    expect(linhas[0]).toHaveAttribute('aria-checked', 'true');
    linhas[2].focus();
    await userEvent.keyboard('{Enter}');
    expect(linhas[2]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Transferir para Caio' })).toBeEnabled();
  });

  test('o Tab fica preso no diálogo', async () => {
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    const dialogo = screen.getByRole('dialog');
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab();
      expect(dialogo.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('TransferModal: desktop e celular', () => {
  test('desktop: sai pelo "Fechar", sem seta de voltar', async () => {
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('celular: só a seta de voltar (sem "Fechar" nem "×"), foco no diálogo e rodapé com Cancelar e Transferir', async () => {
    telaDeCelular();
    const onClose = vi.fn();
    render(<TransferModal conversationId="c1" onClose={onClose} />);
    const dialogo = screen.getByRole('dialog', { name: 'Transferir atendimento' });
    expect(dialogo).toHaveClass('is-celular');
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
    expect(dialogo.querySelector('[data-dialog-close]')).toBeNull();
    // O teclado do celular não sobe sozinho por cima da lista.
    expect(dialogo).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transferir' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // No celular o botão tem meia largura: "Transferir para <nome>" quebrava em
  // duas linhas. A linha escolhida já está à vista, marcada.
  test('celular: com alguém escolhido, o botão continua curto ("Transferir") e transfere para ele', async () => {
    telaDeCelular();
    api.transferConversation.mockResolvedValue({});
    render(<TransferModal conversationId="c1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /other@dw.com/ }));
    const botao = screen.getByRole('button', { name: 'Transferir' });
    expect(botao).toBeEnabled();
    await userEvent.click(botao);
    await waitFor(() => expect(api.transferConversation).toHaveBeenCalledWith('c1', 'agent-2', 'tok-123'));
  });
});

describe('TransferModal: família DW, sem efeitos pesados', () => {
  const ler = (arquivo) => readFileSync(join(AQUI, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const fonte = ler('TransferModal.jsx');

  test('só ícones da família DW: nada de WaIcons, SVG próprio ou biblioteca antiga', () => {
    expect(fonte).not.toMatch(/WaIcons|icons\/|<svg|<path/);
    const icones = [...fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/icones'/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
    expect(icones.sort()).toEqual(['IconeBuscar', 'IconeRecolher', 'IconeTransferir']);
  });

  test('a folha do diálogo não tem desfoque, gradiente, animação, filtro, laranja nem fundo escuro', () => {
    const folha = ler('dialogo-transferir.css');
    expect(folha).not.toMatch(/blur\(|gradient|@keyframes|animation\s*:(?!\s*none)|transition\s*:\s*all|filter\s*:(?!\s*none)/i);
    expect(folha).not.toMatch(/#f28c45|#ff9a6e|#d9b695|#d5a176|#e05a48|orange|chat-orange/i);
    // Cada regra da folha vale só para este diálogo (ou o fundo dele).
    const seletores = folha.replace(/@media[^{]*\{/g, '').match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter(Boolean);
    seletores.forEach((s) => expect(s, s).toMatch(/\[data-dialog='transfer'\]/));
  });

  test('o diálogo desliga a animação e o desfoque da base e não usa as cores escuras', () => {
    const folha = ler('dialogo-transferir.css');
    expect(folha).toMatch(/\[data-dialog='transfer'\]\.dw-dialog\s*\{[^}]*animation:\s*none/);
    expect(folha).toMatch(/\[data-dialog='transfer'\]\.dw-dialog\s*\{[^}]*backdrop-filter:\s*none/);
    expect(folha).toMatch(/:has\(> \[data-dialog='transfer'\]\)\s*\{[^}]*backdrop-filter:\s*none/);
    expect(fonte).not.toMatch(/wa-panel|wa-border|wa-muted|wa-text|chat-online|bg-white\//);
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
