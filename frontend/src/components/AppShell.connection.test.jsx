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

// O que o leitor de tela recebe: a região viva sempre montada da casca, sem
// role="status" (C7-3). O balão visual deriva do mesmo estado.
const avisoLido = () => document.querySelector('[data-aviso-conexao]').textContent;

describe('aviso momentâneo de conexão', () => {
  test('a faixa aparece na queda e some sozinha; quem sustenta o estado é o menu', () => {
    useSocketConnection.mockReturnValue('connected');
    const { rerender } = renderShell();
    expect(avisoLido()).not.toMatch(/reconectando/i);

    useSocketConnection.mockReturnValue('reconnecting');
    rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(avisoLido()).toMatch(/reconectando/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Antes dos 3s combinados ela ainda está lá.
    act(() => { vi.advanceTimersByTime(2500); });
    expect(avisoLido()).toMatch(/reconectando/i);

    // Passados os 3s, sai de cena e não volta sozinha.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(avisoLido()).not.toMatch(/reconectando/i);

    act(() => { vi.advanceTimersByTime(30000); });
    expect(avisoLido()).not.toMatch(/reconectando/i);
  });

  test('ao reconectar mostra confirmação curta e discreta, que também some', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderShell();
    act(() => { vi.advanceTimersByTime(3500); });

    useSocketConnection.mockReturnValue('connected');
    rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(avisoLido()).toMatch(/conexão restabelecida/i);

    act(() => { vi.advanceTimersByTime(3500); });
    expect(avisoLido()).not.toMatch(/conexão restabelecida/i);
  });

  test('conexão saudável desde o início não mostra nenhuma confirmação', () => {
    useSocketConnection.mockReturnValue('connected');
    renderShell();
    expect(avisoLido()).not.toMatch(/conexão restabelecida/i);
  });
});
