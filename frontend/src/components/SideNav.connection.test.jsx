import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useSocketConnection } from '../contexts/SocketContext';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('../contexts/SocketContext');
vi.mock('./ClosedConversationsModal', () => ({ default: () => null }));

function renderNav(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SideNav onProfileClick={vi.fn()} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuth.mockReturnValue({ agent: { id: 'a1', name: 'Ana', role: 'admin' }, logout: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Empresa', status: 'ready' });
});

describe('estado persistente da conexão no menu', () => {
  test('sem queda, nada aparece no rodapé', () => {
    useSocketConnection.mockReturnValue('connected');
    renderNav();
    expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
  });

  test('durante a queda, o indicador fica no menu com texto acessível', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    renderNav();

    const indicador = screen.getByRole('status', { name: /reconectando\. as mensagens novas podem demorar a aparecer\./i });
    expect(indicador).toBeInTheDocument();
    // Alcançável pelo teclado, para a dica do modo recolhido.
    expect(indicador).toHaveAttribute('tabindex', '0');
    // O rótulo curto é o que aparece no menu expandido.
    expect(indicador).toHaveTextContent(/reconectando…/i);
  });

  test('o indicador desaparece assim que a conexão volta', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderNav();
    expect(screen.getByRole('status')).toBeInTheDocument();

    useSocketConnection.mockReturnValue('connected');
    rerender(<MemoryRouter><SideNav onProfileClick={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
