import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SideNav, { iniciaisDaEmpresa } from './SideNav';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('./ClosedConversationsModal', () => ({
  default: ({ onClose }) => <div role="dialog">encerrados<button onClick={onClose}>x</button></div>,
}));

function renderNav(agent, path = '/', props = {}) {
  useAuth.mockReturnValue({ agent, logout: vi.fn() });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SideNav onProfileClick={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'DW Telecom', status: 'ready' });
});

// O logo era o texto fixo "DW": o sistema roda em mais de um provedor.
// Migrado de NavRail.test.jsx (Task 17: NavRail se aposenta, a função vive
// só aqui agora).
describe('iniciaisDaEmpresa', () => {
  test('pega a primeira letra de até duas palavras, em maiúsculas', () => {
    expect(iniciaisDaEmpresa('Net Fibra Ltda')).toBe('NF');
    expect(iniciaisDaEmpresa('provedor')).toBe('P');
  });

  // Nome que já começa por sigla ("DW Telecom") mantém a sigla: pela regra
  // crua das iniciais viraria "DT", que não é o logo de ninguém.
  test('nome que começa por sigla mantém a sigla', () => {
    expect(iniciaisDaEmpresa('DW Telecom')).toBe('DW');
    expect(iniciaisDaEmpresa('MG Fibra Ltda')).toBe('MG');
  });

  test('espaços sobrando não viram inicial vazia', () => {
    expect(iniciaisDaEmpresa('  Net   Fibra  ')).toBe('NF');
  });

  test('sem nome não há iniciais', () => {
    expect(iniciaisDaEmpresa('')).toBe('');
    expect(iniciaisDaEmpresa(null)).toBe('');
    expect(iniciaisDaEmpresa(undefined)).toBe('');
    expect(iniciaisDaEmpresa('   ')).toBe('');
  });
});

describe('SideNav', () => {
  test('atendente vê Atendimento e Relatórios; não vê Campanhas, Supervisão nem Configurações', () => {
    renderNav({ role: 'agent' });
    expect(screen.getByRole('link', { name: /atendimento/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /relatórios/i })).toBeInTheDocument();
    // Campanha dispara mensagem real: a area e administrativa.
    expect(screen.queryByRole('link', { name: /campanhas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /supervisão/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /configurações/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /atendimentos encerrados/i })).toBeInTheDocument();
  });

  test('gerente vê Campanhas no menu, igual ao administrador', () => {
    renderNav({ role: 'manager' });
    expect(screen.getByRole('link', { name: /campanhas/i })).toBeInTheDocument();
  });

  test('gerente vê Supervisão e Configurações e não vê o botão de encerrados', () => {
    renderNav({ role: 'manager' });
    expect(screen.getByRole('link', { name: /supervisão/i })).toHaveAttribute('href', '/supervisao');
    expect(screen.getByRole('link', { name: /configurações/i })).toHaveAttribute('href', '/configuracoes');
    expect(screen.queryByRole('button', { name: /atendimentos encerrados/i })).not.toBeInTheDocument();
  });

  test('marca o item ativo pela rota', () => {
    renderNav({ role: 'admin' }, '/configuracoes/canais');
    expect(screen.getByRole('link', { name: /configurações/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /atendimento/i })).not.toHaveAttribute('aria-current');
  });

  test('recolher esconde os nomes e mantém o rótulo acessível', async () => {
    renderNav({ role: 'admin' }, '/relatorios');
    await userEvent.click(screen.getByRole('button', { name: /recolher menu/i }));
    expect(screen.getByRole('button', { name: /expandir menu/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supervisão/i })).toHaveAttribute('title', 'Supervisão');
    expect(localStorage.getItem('dw_nav_collapsed_administration')).toBe('1');
  });

  test('em modo painel, escolher um item fecha o painel', async () => {
    const onMobileClose = vi.fn();
    renderNav({ role: 'admin' }, '/', { mobileOpen: true, onMobileClose });
    await userEvent.click(screen.getByRole('link', { name: /campanhas/i }));
    expect(onMobileClose).toHaveBeenCalled();
  });

  test('em modo painel, Esc fecha', async () => {
    const onMobileClose = vi.fn();
    renderNav({ role: 'admin' }, '/', { mobileOpen: true, onMobileClose });
    await userEvent.keyboard('{Escape}');
    expect(onMobileClose).toHaveBeenCalled();
  });

  test('mostra a logo oficial e o botão de som', () => {
    renderNav({ role: 'agent' });
    // O texto alternativo vem do nome da empresa (useCompanyName), nao de uma
    // marca escrita no componente: e por isso que ele diz "DW Telecom" aqui.
    expect(screen.getByRole('img', { name: 'DW Telecom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });

  test('clica em "Meu perfil" chama onProfileClick', async () => {
    const onProfileClick = vi.fn();
    renderNav({ role: 'agent' }, '/', { onProfileClick });
    await userEvent.click(screen.getByRole('button', { name: /^conta:/i }));
    await userEvent.click(screen.getByRole('button', { name: /^meu perfil$/i }));
    expect(onProfileClick).toHaveBeenCalledTimes(1);
  });

  test('com o som mutado, o botão vira "Som desativado"', () => {
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderNav({ role: 'agent' });
    expect(screen.getByRole('button', { name: /som desativado/i })).toBeInTheDocument();
  });

  test('clicar no botão de som chama toggleMuted', async () => {
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderNav({ role: 'agent' });
    await userEvent.click(screen.getByRole('button', { name: /som ativado/i }));
    expect(toggleMuted).toHaveBeenCalledTimes(1);
  });
});

test('chat defaults to compact while administration defaults to expanded', () => {
  const view = renderNav({ role: 'admin' });
  expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeInTheDocument();
  view.unmount();
  renderNav({ role: 'admin' }, '/relatorios');
  expect(screen.getByRole('button', { name: 'Recolher menu' })).toBeInTheDocument();
});
test('account exposes logout and closes with Escape', async () => {
  renderNav({ role: 'admin' });
  expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^conta:/i }));
  expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
});

// F1 — o veu do menu mobile estava na MESMA camada da gaveta (--z-nav) e, por
// vir depois no DOM, pintava por cima dela: no celular a gaveta abria
// escurecida e nenhum toque a alcancava, porque todo clique caia no veu.
describe('menu mobile: a gaveta fica acima do veu', () => {
  function abrirNoMobile() {
    const onMobileClose = vi.fn();
    const r = renderNav({ role: 'admin' }, '/', { mobileOpen: true, onMobileClose });
    const gaveta = r.container.querySelector('.worknav.is-mobile-open');
    const veu = r.container.querySelector('[aria-hidden="true"][class*="fixed inset-0"]');
    return { ...r, onMobileClose, gaveta, veu };
  }

  test('a gaveta usa a camada da navegacao e o veu fica um degrau abaixo', () => {
    const { gaveta, veu } = abrirNoMobile();

    expect(gaveta).toBeInTheDocument();
    expect(veu).toBeInTheDocument();
    // Nenhum numero magico: os dois saem da escala --z-*.
    expect(veu.className).toContain('z-[calc(var(--z-nav)-1)]');
    expect(veu.className).not.toContain('z-[var(--z-nav)]');
  });

  test('clicar no veu continua fechando o menu', async () => {
    const { veu, onMobileClose } = abrirNoMobile();
    await userEvent.click(veu);
    expect(onMobileClose).toHaveBeenCalled();
  });

  test('clicar DENTRO da gaveta nao fecha o menu', async () => {
    const { gaveta, onMobileClose } = abrirNoMobile();
    const item = within(gaveta).getByRole('button', { name: /som (ativado|desativado)/i });

    await userEvent.click(item);

    expect(onMobileClose).not.toHaveBeenCalled();
  });

  test('sem o menu aberto nao existe veu nenhum', () => {
    const { container } = renderNav({ role: 'admin' }, '/', { mobileOpen: false });
    expect(container.querySelector('[aria-hidden="true"][class*="fixed inset-0"]')).toBeNull();
    expect(container.querySelector('.worknav.is-mobile-open')).toBeNull();
  });
});
