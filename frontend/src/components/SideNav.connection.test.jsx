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

// C7-1/C7-5: o menu tinha um segundo indicador da queda, com dica própria que
// o toque não revelava. Agora o estado inteiro é o aviso único da casca
// (AvisoDeConexao); o menu não desenha nada disso.
describe('o menu não repete o aviso de conexão', () => {
  test.each(['connected', 'reconnecting'])('com a conexão %s, nenhum indicador no menu', (estado) => {
    useSocketConnection.mockReturnValue(estado);
    const { container } = renderNav();
    expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
    expect(container.querySelector('.worknav-connection')).toBeNull();
  });
});
