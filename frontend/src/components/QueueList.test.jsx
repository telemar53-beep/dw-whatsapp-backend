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

// Prova de FIAÇÃO, não de unidade. A regra vive em place.js e a decisão em
// ConversationListItem, mas nada disso chega à tela se QueueList esquecer de
// repassar a prop — e os testes daqueles dois continuariam verdes.
describe('QueueList repassa soLocalidade para a linha', () => {
  const CONVERSA = {
    id: 'q1',
    contactDisplayName: 'Carlos',
    contactPhoneNumber: '+551199',
    contactCityName: 'Cândido Mendes',
    contactLocalityName: 'Barão de Tromaí',
    createdAt: '2026-09-22T12:00:00.000Z',
  };

  function renderFila(props) {
    render(<QueueList conversations={[CONVERSA]} status="success" onSelect={vi.fn()} {...props} />);
  }

  test('com soLocalidade, a linha mostra só a localidade', () => {
    renderFila({ soLocalidade: true });

    expect(screen.getByText('Barão de Tromaí')).toBeInTheDocument();
    expect(screen.queryByText(/Cândido Mendes/)).not.toBeInTheDocument();
  });

  // A aba "Automação" usa o MESMO QueueList e não passa a prop: ela não pode
  // ter mudado junto.
  test('sem a prop, a linha continua com localidade · município', () => {
    renderFila({});

    expect(screen.getByText('Barão de Tromaí · Cândido Mendes')).toBeInTheDocument();
  });

  test('sem localidade, a fila mostra o município', () => {
    render(
      <QueueList
        conversations={[{ ...CONVERSA, contactLocalityName: null }]}
        status="success"
        onSelect={vi.fn()}
        soLocalidade
      />
    );

    expect(screen.getByText('Cândido Mendes')).toBeInTheDocument();
  });
});
