import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav';
import { useAuth } from '../contexts/AuthContext';
import { useCompanyName } from '../hooks/useCompanyName';
import { useSocketConnection } from '../contexts/SocketContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';

// Etapa 7.3 — a marca do menu vinha de dois `import` fixos no topo do SideNav.
// Outro provedor que instalasse o produto veria a marca da DW no menu, com
// "DW Telecom" no alt, e o proprio nome so no tooltip. Este arquivo trava a
// separacao: identidade da INSTALACAO x fundacao do PRODUTO.
//
// A instalacao SEM marca e o caminho neutro; por isso o mock vem vazio aqui.
vi.mock('../branding', () => ({
  marcaDaInstalacao: { compacta: null, horizontal: null },
  instalacaoTemMarca: () => false,
}));

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCompanyName');
vi.mock('../contexts/SocketContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('./ClosedConversationsModal', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ agent: { id: 'a1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
  useSocketConnection.mockReturnValue('connected');
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
});

// Em "/" a barra abre recolhida (e a mesa de atendimento); para ver o rotulo
// expandido o teste usa outra rota.
function renderNav(rota = '/') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <SideNav />
    </MemoryRouter>
  );
}

describe('menu sem marca configurada', () => {
  test('usa o monograma com as iniciais da empresa, nao a marca de outro provedor', () => {
    useCompanyName.mockReturnValue({ name: 'Net Fibra Ltda', status: 'ready' });
    const { container } = renderNav();

    expect(container.querySelector('.worknav-monogram')).toHaveTextContent('NF');
    expect(container.querySelector('img.worknav-logo')).toBeNull();
    expect(container.querySelector('img.worknav-full-logo')).toBeNull();
    // Nenhum vestigio da marca de outra instalacao.
    expect(container.textContent).not.toMatch(/DW/);
  });

  test('o nome da empresa aparece no menu expandido e no tooltip', () => {
    useCompanyName.mockReturnValue({ name: 'Net Fibra Ltda', status: 'ready' });
    const { container } = renderNav('/relatorios');

    expect(screen.getByText('Net Fibra Ltda')).toBeInTheDocument();
    expect(container.querySelector('.worknav-brand')).toHaveAttribute('title', 'Net Fibra Ltda');
  });

  // Se o monograma ja aparecesse com as iniciais de "" a barra pularia quando
  // a resposta chegasse. O espaco fica reservado e o simbolo entra depois.
  test('enquanto o nome carrega, o monograma fica vazio sem derrubar o layout', () => {
    useCompanyName.mockReturnValue({ name: '', status: 'loading' });
    const { container } = renderNav();

    const monograma = container.querySelector('.worknav-monogram');
    expect(monograma).toBeInTheDocument();
    expect(monograma).toHaveTextContent('');
  });

  test('sem nome e sem marca, o produto continua de pe com rotulo neutro', () => {
    useCompanyName.mockReturnValue({ name: '', status: 'error' });
    const { container } = renderNav();

    expect(container.querySelector('.worknav-monogram')).toBeInTheDocument();
    expect(container.querySelector('.worknav-brand')).toHaveAttribute('title', 'Atendimento');
  });
});
