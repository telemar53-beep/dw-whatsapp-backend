import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav';
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

describe('SideNav', () => {
  test('atendente vê Atendimento, Campanhas e Relatórios; não vê Supervisão nem Configurações', () => {
    renderNav({ role: 'agent' });
    expect(screen.getByRole('link', { name: /atendimento/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /campanhas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /relatórios/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /supervisão/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /configurações/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /atendimentos encerrados/i })).toBeInTheDocument();
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
    renderNav({ role: 'admin' });
    await userEvent.click(screen.getByRole('button', { name: /recolher menu/i }));
    expect(screen.getByRole('button', { name: /expandir menu/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supervisão/i })).toHaveAttribute('title', 'Supervisão');
    expect(localStorage.getItem('dw_nav_collapsed')).toBe('1');
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

  test('mostra as iniciais da empresa e o botão de som', () => {
    renderNav({ role: 'agent' });
    expect(screen.getByText('DW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });

  test('clica em "Meu perfil" chama onProfileClick', async () => {
    const onProfileClick = vi.fn();
    renderNav({ role: 'agent' }, '/', { onProfileClick });
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
