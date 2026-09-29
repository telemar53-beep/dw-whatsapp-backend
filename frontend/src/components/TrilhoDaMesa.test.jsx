import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TrilhoDaMesa, { iniciais, IconeDoMenu } from './TrilhoDaMesa';
import { IconeMenu } from './icones';
import { iniciaisDaEmpresa } from './SideNav';
import { useAuth } from '../contexts/AuthContext';
import { useSocket, useSocketConnection } from '../contexts/SocketContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useAgents } from '../hooks/useAgents';

vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set(['a1']) }));
vi.mock('./ClosedConversationsModal', () => ({ default: () => <div role="dialog">encerrados</div> }));

const ATENDENTE = { id: 'a1', name: 'Atendente A', role: 'agent' };
const ADMIN = { id: 'a2', name: 'Atendente B', role: 'admin' };
const GERENTE = { id: 'a3', name: 'Atendente C', role: 'manager' };

let logout;
let toggleMuted;
let retangulos;

function renderTrilho(agent, props = {}, rota = '/') {
  useAuth.mockReturnValue({ agent, logout });
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <TrilhoDaMesa onProfileClick={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

const trilho = () => screen.getByRole('navigation', { name: 'Navegação principal' });

beforeEach(() => {
  vi.clearAllMocks();
  logout = vi.fn();
  toggleMuted = vi.fn();
  useSocket.mockReturnValue(null);
  useSocketConnection.mockReturnValue('connected');
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
  useCompanyName.mockReturnValue({ name: 'DW Telecom', status: 'ready' });
  // O foco inicial só vai para elementos visíveis (getClientRects), e o jsdom
  // não calcula layout: sem isto, nada contaria como visível.
  retangulos = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 1, height: 1 }]);
  useAgents.mockReturnValue({ agents: [{ id: 'a1', name: 'Atendente A', online: true, activeConversations: 0 }], status: 'ready', error: null, loading: false, refresh: vi.fn() });
});

afterEach(() => retangulos.mockRestore());

describe('trilho da mesa', () => {
  test('é um trilho: sem botão de recolher e com o rótulo só na dica', () => {
    renderTrilho(ATENDENTE);
    expect(trilho()).toHaveAttribute('data-variante', 'mesa');
    expect(screen.queryByRole('button', { name: /recolher menu|expandir menu/i })).not.toBeInTheDocument();
    const atendimento = screen.getByRole('link', { name: 'Atendimento' });
    expect(within(atendimento).getByText('Atendimento')).toHaveAttribute('aria-hidden', 'true');
  });

  test('atendente: Atendimento, Equipe, Relatórios, Encerrados, som e conta; nenhum atalho restrito', () => {
    renderTrilho(ATENDENTE);
    expect(screen.getByRole('link', { name: 'Atendimento' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Relatórios' })).toHaveAttribute('href', '/relatorios');
    expect(screen.getByRole('button', { name: /^equipe/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atendimentos encerrados' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /som da fila/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /conta: atendente a/i })).toBeInTheDocument();
    for (const nome of [/filas/i, /canais/i, /campanhas/i, /configurações/i]) {
      expect(screen.queryByRole('link', { name: nome })).not.toBeInTheDocument();
    }
  });

  test('admin: Filas leva à Supervisão; Campanhas e Configurações como hoje; sem atalho de Canais', () => {
    renderTrilho(ADMIN);
    expect(screen.getByRole('link', { name: /^filas/i })).toHaveAttribute('href', '/supervisao');
    // Canais (Números conectados) saiu do trilho: mora em Configurações.
    expect(screen.queryByRole('link', { name: /canais|números conectados/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Campanhas' })).toHaveAttribute('href', '/campanhas');
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('href', '/configuracoes');
    // Encerrados continua só do atendente, como no menu das outras páginas.
    expect(screen.queryByRole('button', { name: 'Atendimentos encerrados' })).not.toBeInTheDocument();
  });

  test('gerente vê os mesmos atalhos que o admin', () => {
    renderTrilho(GERENTE);
    expect(screen.getByRole('link', { name: /^filas/i })).toHaveAttribute('href', '/supervisao');
    expect(screen.getByRole('link', { name: 'Campanhas' })).toBeInTheDocument();
  });

  test('na rota de Canais, quem fica ativo é Configurações — também na gaveta do celular', () => {
    for (const mobileOpen of [false, true]) {
      const { unmount } = renderTrilho(ADMIN, { mobileOpen }, '/configuracoes/canais');
      expect(screen.queryByRole('link', { name: /canais|números conectados/i })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Atendimento' })).not.toHaveAttribute('aria-current');
      unmount();
    }
  });

  // Configurações desenha o trilho sem o botão Equipe: o painel pediria a lista
  // de atendentes (GET /api/agents) só por entrar na área.
  test('semEquipe: sem o botão Equipe e sem pedir a lista de atendentes; o resto igual', () => {
    renderTrilho(ADMIN, { semEquipe: true }, '/configuracoes/canais');
    expect(screen.queryByRole('button', { name: /^equipe/i })).not.toBeInTheDocument();
    expect(useAgents).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Atendimento' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Filas (Supervisão)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('aria-current', 'page');
  });

  test('sem semEquipe, o botão Equipe continua lá (mesa, Supervisão)', () => {
    renderTrilho(ADMIN);
    expect(screen.getByRole('button', { name: /^equipe/i })).toBeInTheDocument();
    expect(useAgents).toHaveBeenCalled();
  });

  test('na mesa, Atendimento é a página atual', () => {
    renderTrilho(ADMIN);
    expect(screen.getByRole('link', { name: 'Atendimento' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^filas/i })).not.toHaveAttribute('aria-current');
  });

  test('Equipe abre o popup "Nossa equipe" e mostra quantos estão online', async () => {
    renderTrilho(ATENDENTE);
    const equipe = screen.getByRole('button', { name: /^equipe/i });
    expect(equipe).toHaveAccessibleName('Equipe: 1 online');
    await userEvent.click(equipe);
    // O popup chega sob demanda (TeamPanel).
    expect(await screen.findByRole('heading', { name: 'Nossa equipe' })).toBeInTheDocument();
  });

  test('som da fila alterna, e o estado muda o nome e o ícone', async () => {
    const { unmount } = renderTrilho(ATENDENTE);
    const ligado = screen.getByRole('button', { name: /som da fila/i });
    expect(ligado).toHaveAccessibleName('Som da fila — Som ativado');
    const desenhoLigado = ligado.querySelector('svg').innerHTML;
    await userEvent.click(ligado);
    expect(toggleMuted).toHaveBeenCalledTimes(1);
    unmount();

    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted });
    renderTrilho(ATENDENTE);
    const desligado = screen.getByRole('button', { name: /som da fila/i });
    expect(desligado).toHaveAccessibleName('Som da fila — Som desativado');
    expect(desligado.querySelector('svg').innerHTML).not.toBe(desenhoLigado);
  });

  test('conta: Meu perfil e Sair; "Meu perfil" sem ícone, o foco entra no painel e Esc devolve ao avatar', async () => {
    const onProfileClick = vi.fn();
    renderTrilho(ATENDENTE, { onProfileClick });
    const conta = screen.getByRole('button', { name: /conta: atendente a/i });
    await userEvent.click(conta);
    const perfil = screen.getByRole('button', { name: 'Meu perfil' });
    expect(perfil).toHaveFocus();
    // Os dois itens só com texto, iguais em tudo: mesma classe, mesmo
    // conteúdo (só o rótulo), sem ícone em nenhum.
    const sair = screen.getByRole('button', { name: 'Sair' });
    for (const item of [perfil, sair]) {
      expect(item.querySelector('svg')).toBeNull();
      expect(item.children).toHaveLength(0);
    }
    expect(perfil.className).toBe(sair.className);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Meu perfil' })).not.toBeInTheDocument();
    expect(conta).toHaveFocus();

    await userEvent.click(conta);
    await userEvent.click(screen.getByRole('button', { name: 'Meu perfil' }));
    expect(onProfileClick).toHaveBeenCalledTimes(1);
    await userEvent.click(conta);
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('Encerrados abre a lista de encerrados do atendente', async () => {
    renderTrilho(ATENDENTE);
    await userEvent.click(screen.getByRole('button', { name: 'Atendimentos encerrados' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('encerrados');
  });

  // C7-1: a queda tinha dois indicadores (o do trilho e o balão da casca).
  // Agora é um aviso só, o da casca (AvisoDeConexao); o trilho não repete.
  test('queda de conexão não vira um segundo indicador no trilho', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    renderTrilho(ATENDENTE);
    expect(within(trilho()).queryByText(/reconectando/i)).not.toBeInTheDocument();
    expect(trilho().querySelector('.worknav-connection')).toBeNull();
  });

  test('gaveta do celular: abre com o foco no primeiro destino, Esc e o véu fecham', async () => {
    const onMobileClose = vi.fn();
    const { container } = renderTrilho(ATENDENTE, { mobileOpen: true, onMobileClose });
    expect(trilho()).toHaveClass('is-mobile-open');
    expect(screen.getByRole('link', { name: 'Atendimento' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onMobileClose).toHaveBeenCalledTimes(1);
    await userEvent.click(container.querySelector('div[aria-hidden="true"].fixed'));
    expect(onMobileClose).toHaveBeenCalledTimes(2);
  });

  test('todo ícone do trilho é da família DW, nenhum do conjunto antigo', () => {
    renderTrilho(ADMIN);
    const desenhos = [...trilho().querySelectorAll('svg')];
    // 7 no admin: Atendimento, Filas, Equipe, Campanhas, Relatórios, som e
    // Configurações (Canais saiu do trilho).
    expect(desenhos.length).toBeGreaterThanOrEqual(7);
    desenhos.forEach((svg) => {
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke-width')).toBe('1.75');
      expect(svg.getAttribute('fill')).toBe('none');
    });
  });
});

// O botão "Abrir menu" do celular usa o ícone de menu da família, reto — não
// o chevron girado, que lia como "voltar".
describe('ícone do botão "Abrir menu"', () => {
  test('é o ícone de menu da família DW, sem rotação', () => {
    const { container: doBotao } = render(<IconeDoMenu />);
    const { container: doMenu } = render(<IconeMenu />);
    const svg = doBotao.querySelector('svg');
    expect(svg.innerHTML).toBe(doMenu.querySelector('svg').innerHTML);
    expect(svg.getAttribute('style')).toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

// A cópia das iniciais existe para o trilho não importar o SideNav (ver o
// comentário em TrilhoDaMesa.jsx). As duas têm de dar o mesmo resultado.
describe('iniciais da marca sem arte', () => {
  test.each(['DW Telecom', 'Net Fibra Brasil', 'provedor', '  ', '', null, 'AB Net', 'Ab Net', 'É Rede'])('"%s" dá o mesmo que no menu', (nome) => {
    expect(iniciais(nome)).toBe(iniciaisDaEmpresa(nome));
  });
});
