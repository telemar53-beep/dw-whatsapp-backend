import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';
import { useSocketConnection } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/SocketContext');
// A casca lê o nível de acesso (o encaixe do trilho na Supervisão é só para
// quem pode vê-la).
vi.mock('../contexts/AuthContext');
// A casca so precisa existir em volta; quem interessa aqui e o aviso.
vi.mock('./SideNav', () => ({ default: () => <nav data-testid="sidenav" /> }));
vi.mock('./ProfileModal', () => ({ default: () => null }));

const AQUI = dirname(fileURLToPath(import.meta.url));

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>
  );
}
const redesenhar = (rerender) => rerender(<MemoryRouter><AppShell /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ agent: { role: 'agent' } });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// O que o leitor de tela recebe: a região viva sempre montada da casca, sem
// role="status" (C7-3). O aviso visual deriva do mesmo estado, mudo.
const avisoLido = () => document.querySelector('[data-aviso-conexao]').textContent;
const avisosNaTela = () => document.querySelectorAll('.aviso-conexao');

// Um aviso só, no canto, para o estado inteiro (C7): "Reconectando…" enquanto
// a conexão não volta — também no celular, onde o menu é gaveta — e, no mesmo
// lugar, "Conexão restabelecida" por 3 s.
describe('aviso único de conexão', () => {
  test('a queda mostra "Reconectando…" e ele fica enquanto a conexão não volta', () => {
    useSocketConnection.mockReturnValue('connected');
    const { rerender } = renderShell();
    expect(avisoLido()).toBe('');
    expect(avisosNaTela()).toHaveLength(0);

    useSocketConnection.mockReturnValue('reconnecting');
    redesenhar(rerender);
    expect(avisoLido()).toMatch(/reconectando/i);
    expect(avisosNaTela()).toHaveLength(1);
    expect(avisosNaTela()[0]).toHaveTextContent('Reconectando… as mensagens novas podem demorar a aparecer.');
    expect(avisosNaTela()[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(60000); });
    expect(avisoLido()).toMatch(/reconectando/i);
    expect(avisosNaTela()).toHaveLength(1);
  });

  test('a volta troca o mesmo aviso por "Conexão restabelecida", que some em 3 s', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderShell();
    act(() => { vi.advanceTimersByTime(3500); });

    useSocketConnection.mockReturnValue('connected');
    redesenhar(rerender);
    expect(avisoLido()).toMatch(/conexão restabelecida/i);
    expect(avisosNaTela()).toHaveLength(1);
    expect(avisosNaTela()[0]).toHaveTextContent('Conexão restabelecida.');
    expect(avisosNaTela()[0]).toHaveAttribute('data-estado', 'voltou');

    act(() => { vi.advanceTimersByTime(2500); });
    expect(avisosNaTela()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(avisoLido()).toBe('');
    expect(avisosNaTela()).toHaveLength(0);
  });

  test('cair de novo durante a confirmação volta direto para "Reconectando…", sem dois avisos', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderShell();
    useSocketConnection.mockReturnValue('connected');
    redesenhar(rerender);
    act(() => { vi.advanceTimersByTime(1000); });

    useSocketConnection.mockReturnValue('reconnecting');
    redesenhar(rerender);
    expect(avisosNaTela()).toHaveLength(1);
    expect(avisosNaTela()[0]).toHaveAttribute('data-estado', 'caiu');
    // O relógio da confirmação anterior não apaga o "Reconectando…".
    act(() => { vi.advanceTimersByTime(5000); });
    expect(avisosNaTela()).toHaveLength(1);
    expect(avisoLido()).toMatch(/reconectando/i);
  });

  test('conexão saudável desde o início não mostra nada', () => {
    useSocketConnection.mockReturnValue('connected');
    renderShell();
    expect(avisoLido()).toBe('');
    expect(avisosNaTela()).toHaveLength(0);
  });

  test('saída da conta (idle) apaga o aviso', () => {
    useSocketConnection.mockReturnValue('reconnecting');
    const { rerender } = renderShell();
    useSocketConnection.mockReturnValue('idle');
    redesenhar(rerender);
    expect(avisosNaTela()).toHaveLength(0);
  });

  test('a folha do aviso: sólida, sem desfoque, animação, gradiente ou laranja', () => {
    const folha = readFileSync(join(AQUI, 'aviso-de-conexao.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(folha).not.toMatch(/blur\(|backdrop-filter:(?!\s*none)/);
    expect(folha).not.toMatch(/animation:(?!\s*none)|@keyframes/);
    expect(folha).not.toMatch(/gradient\(/);
    expect(folha).not.toMatch(/#(f2a93c|f0b65f|e5a16d|ff8d40|f5a524)/i);
    expect(folha).toMatch(/pointer-events:\s*none/);
  });
});
