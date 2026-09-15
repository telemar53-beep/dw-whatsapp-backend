import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from './AppShell';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('./ProfileModal', () => ({ default: () => <div role="dialog">perfil</div> }));
vi.mock('./ClosedConversationsModal', () => ({ default: () => <div role="dialog">encerrados</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuth.mockReturnValue({ agent: { role: 'agent' }, logout: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'DW Telecom', status: 'ready' });
});

function renderShell() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>conteúdo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppShell', () => {
  // A altura da viewport era controlada por cada página (`h-dvh` na raiz
  // própria); agora é o AppShell que carrega essa classe para todas elas.
  test('a raiz usa h-dvh para a altura da viewport', () => {
    const { container } = renderShell();
    expect(container.firstChild.className).toContain('h-dvh');
  });

  test('renderiza o conteúdo da rota através do Outlet', () => {
    renderShell();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  test('mostra o botão de abrir o menu no mobile', () => {
    renderShell();
    expect(screen.getByTestId('open-mobile-nav')).toBeInTheDocument();
  });
});
