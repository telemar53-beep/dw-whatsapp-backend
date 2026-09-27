import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';
import { MemoryRouter, Routes, Route, useOutletContext } from 'react-router-dom';
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

// Página de teste que faz o que a mesa faz: desenha nos encaixes da casca.
function PaginaComEncaixe() {
  const { encaixeDoTrilho, encaixeDoIcone, mobileNavOpen } = useOutletContext();
  return <>
    <p>mesa</p>
    {encaixeDoTrilho && createPortal(<nav aria-label="Trilho de teste" data-aberto={String(mobileNavOpen)} />, encaixeDoTrilho)}
    {encaixeDoIcone && createPortal(<svg data-testid="icone-da-pagina" />, encaixeDoIcone)}
  </>;
}

function renderShell(rota = '/', paginaDaMesa = <p>conteúdo</p>, paginaDaSupervisao = <p>supervisão</p>) {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={paginaDaMesa} />
          <Route path="/supervisao" element={paginaDaSupervisao} />
          <Route path="/relatorios" element={<p>relatórios</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const menu = () => screen.getByRole('navigation', { name: 'Navegação principal' });
// Os brilhos do fundo: divs com `blur-[150px]`. Filtro em JS porque o seletor
// do jsdom não casa `[` dentro de um valor de atributo.
const brilhos = (container) => [...container.querySelectorAll('div')].filter((div) => /(^|\s)blur-\[/.test(div.className));

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

  // Só o Atendimento recebe o trilho novo. Os dois brilhos com blur de 150px
  // saem da mesa, que é a tela aberta o dia inteiro nas máquinas fracas.
  test('na mesa, a casca não desenha o menu: reserva o encaixe e tira os brilhos', () => {
    const { container } = renderShell('/');
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-encaixe="trilho"]')).toBeInTheDocument();
    expect(brilhos(container)).toHaveLength(0);
    // O botão do celular fica sem o ícone antigo: o da mesa vem da página.
    expect(screen.getByTestId('open-mobile-nav').querySelector('svg')).toBeNull();
  });

  test('a página da mesa desenha o trilho e o ícone do botão nos encaixes', async () => {
    const { container } = renderShell('/', <PaginaComEncaixe />);
    const trilho = await screen.findByRole('navigation', { name: 'Trilho de teste' });
    expect(container.querySelector('[data-encaixe="trilho"]')).toContainElement(trilho);
    expect(screen.getByTestId('open-mobile-nav')).toContainElement(screen.getByTestId('icone-da-pagina'));
    expect(trilho).toHaveAttribute('data-aberto', 'false');
    await userEvent.click(screen.getByTestId('open-mobile-nav'));
    expect(trilho).toHaveAttribute('data-aberto', 'true');
  });

  // O ícone vem da página por portal, e evento de portal sobe pela árvore
  // React de quem o desenhou (a página), não pelo botão da casca: um toque
  // que caísse no ícone não abria o menu. O encaixe não recebe toque, então o
  // toque cai no próprio botão (visto no navegador, a 390 px).
  test('o toque no ícone da mesa cai no botão: o encaixe do ícone não recebe ponteiro', () => {
    renderShell('/', <PaginaComEncaixe />);
    const encaixe = screen.getByTestId('icone-da-pagina').parentElement;
    expect(screen.getByTestId('open-mobile-nav')).toContainElement(encaixe);
    expect(getComputedStyle(encaixe).pointerEvents).toBe('none');
  });

  // A Supervisão nova usa o mesmo trilho estreito da mesa (mockup de 27/09),
  // pelo mesmo encaixe: a casca continua sem importar nada do trilho, e os
  // brilhos de 150px saem também dali.
  test('na Supervisão, a casca reserva o encaixe do trilho e tira os brilhos', () => {
    useAuth.mockReturnValue({ agent: { role: 'admin' }, logout: vi.fn() });
    const { container } = renderShell('/supervisao');
    expect(screen.getByText('supervisão')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-encaixe="trilho"]')).toBeInTheDocument();
    expect(brilhos(container)).toHaveLength(0);
    expect(screen.getByTestId('open-mobile-nav').querySelector('svg')).toBeNull();
  });

  test('a página da Supervisão desenha o trilho e o ícone do botão nos encaixes', async () => {
    useAuth.mockReturnValue({ agent: { role: 'manager' }, logout: vi.fn() });
    const { container } = renderShell('/supervisao', undefined, <PaginaComEncaixe />);
    const trilho = await screen.findByRole('navigation', { name: 'Trilho de teste' });
    expect(container.querySelector('[data-encaixe="trilho"]')).toContainElement(trilho);
    expect(screen.getByTestId('open-mobile-nav')).toContainElement(screen.getByTestId('icone-da-pagina'));
  });

  // Quem não tem acesso vê a página de acesso negado, que não desenha trilho:
  // com o encaixe reservado, ficaria sem menu nenhum.
  test('atendente em /supervisao continua com o menu de sempre', () => {
    const { container } = renderShell('/supervisao');
    expect(menu()).toBeInTheDocument();
    expect(container.querySelector('[data-encaixe="trilho"]')).toBeNull();
  });

  test('fora da mesa, o botão de abrir o menu continua com o ícone de antes', () => {
    renderShell('/relatorios');
    expect(screen.getByTestId('open-mobile-nav').querySelector('svg')).not.toBeNull();
    expect(screen.queryByTestId('icone-da-pagina')).not.toBeInTheDocument();
  });

  test('fora da mesa, o menu e o fundo continuam os de sempre', () => {
    const { container } = renderShell('/relatorios');
    expect(screen.getByText('relatórios')).toBeInTheDocument();
    expect(menu()).not.toHaveAttribute('data-variante');
    expect(screen.getByRole('button', { name: /recolher menu|expandir menu/i })).toBeInTheDocument();
    expect(brilhos(container)).toHaveLength(2);
  });
});
