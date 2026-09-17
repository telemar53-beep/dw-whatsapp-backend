import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import QueueList from './QueueList';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// A fila é ordenada por chegada. Mostrar a hora da última mensagem fazia ela
// parecer fora de ordem sem estar: quem chegou primeiro e falou de novo agora
// aparecia no topo com um horário mais recente que o de quem chegou depois.
describe('QueueList', () => {
  const CHEGADA = '2026-09-17T12:00:00.000Z';
  const ULTIMA = '2026-09-17T15:00:00.000Z';

  test('a linha mostra a hora em que o cliente entrou na fila', () => {
    render(
      <QueueList
        status="ready"
        conversations={[
          { id: 'c1', contactDisplayName: 'Ana Julia', contactPhoneNumber: '+551199', createdAt: CHEGADA, lastMessageAt: ULTIMA },
        ]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText(hora(CHEGADA))).toBeInTheDocument();
    expect(screen.queryByText(hora(ULTIMA))).not.toBeInTheDocument();
  });

  test('mantém a ordem que o backend entregou, que é a de chegada', () => {
    render(
      <QueueList
        status="ready"
        conversations={[
          { id: 'c1', contactDisplayName: 'Primeiro', contactPhoneNumber: '+551199', createdAt: '2026-09-17T12:00:00.000Z' },
          { id: 'c2', contactDisplayName: 'Segundo', contactPhoneNumber: '+551198', createdAt: '2026-09-17T13:00:00.000Z' },
          { id: 'c3', contactDisplayName: 'Terceiro', contactPhoneNumber: '+551197', createdAt: '2026-09-17T14:00:00.000Z' },
        ]}
        onSelect={vi.fn()}
      />
    );

    const nomes = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(nomes[0]).toContain('Primeiro');
    expect(nomes[1]).toContain('Segundo');
    expect(nomes[2]).toContain('Terceiro');
  });

  test('fila vazia mostra a mensagem de vazio', () => {
    render(<QueueList status="ready" conversations={[]} onSelect={vi.fn()} emptyMessage="Nenhum atendimento em espera." />);

    expect(screen.getByText('Nenhum atendimento em espera.')).toBeInTheDocument();
  });
});
