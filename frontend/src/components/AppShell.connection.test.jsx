import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';
import { useSocketConnection } from '../contexts/SocketContext';

vi.mock('../contexts/SocketContext');
// A casca so precisa existir em volta; quem interessa aqui e o aviso.
vi.mock('./SideNav', () => ({ default: () => <nav data-testid="sidenav" /> }));
vi.mock('./ProfileModal', () => ({ default: () => null }));

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('aviso momentâneo de conexão', () => {
  test('a faixa aparece na queda e some sozinha; quem sustenta o estado é o menu', () => {
    useSocketConnection.mockReturnValue('connected');
    const { rerender } = renderShell();
    expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();

    useSocketConnection.mockReturnValue('reconnecting');
    rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByText(/reconectando/i)).toBeInTheDocument();

    // Antes dos 3s combinados ela ainda está lá.
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.getByText(/reconectando/i)).toBeInTheDocument();

    // Passados os 3s, sai de cena e não volta sozinha.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
  });

  test('ao reconectar mostra confirmação curta e discreta, que também some', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderShell();
    act(() => { vi.advanceTimersByTime(3500); });

    useSocketConnection.mockReturnValue('connected');
    rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(screen.getByText(/conexão restabelecida/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.queryByText(/conexão restabelecida/i)).not.toBeInTheDocument();
  });

  test('conexão saudável desde o início não mostra nenhuma confirmação', () => {
    useSocketConnection.mockReturnValue('connected');
    renderShell();
    expect(screen.queryByText(/conexão restabelecida/i)).not.toBeInTheDocument();
  });
});
