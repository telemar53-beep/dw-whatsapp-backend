import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClosedConversationsModal from './ClosedConversationsModal';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useMyClosedConversations');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');
// Só o que a edição do contato e o painel ao lado chamam; as listas ficam
// pendentes por padrão, como a chamada real ficava no jsdom.
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getMyClosedConversations: vi.fn(),
  updateContact: vi.fn(),
  listCities: vi.fn(() => new Promise(() => {})),
  listSectors: vi.fn(() => new Promise(() => {})),
}));

const CLOSED_CONVERSATION = {
  id: 'c-old',
  contactDisplayName: 'Ana Encerrada',
  status: 'closed',
  assignedAgentId: 'agent-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useMyClosedConversations.mockReturnValue({
    items: [CLOSED_CONVERSATION],
    hasMore: false,
    loading: false,
    status: 'ready',
    loadMore: vi.fn(),
    refresh: vi.fn(),
  });
});

describe('ClosedConversationsModal', () => {
  test('shows the agent\'s closed conversations', () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByText('Ana Encerrada')).toBeInTheDocument();
  });

  test('closing the dialog calls onClose', async () => {
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  test('selecting a closed conversation opens it read-only, without message input or action buttons', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);

    await userEvent.click(screen.getByText('Ana Encerrada'));

    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fechar atendimento/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/mensagem/i)).not.toBeInTheDocument();
  });

  test('clicking Carregar mais calls loadMore', async () => {
    const loadMore = vi.fn();
    useMyClosedConversations.mockReturnValue({
      items: [CLOSED_CONVERSATION],
      hasMore: true,
      loading: false,
      status: 'ready',
      loadMore,
      refresh: vi.fn(),
    });
    render(<ClosedConversationsModal onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }));

    expect(loadMore).toHaveBeenCalled();
  });

  // CVM-ENC-11: antes o erro do "Carregar mais" voltava calado.
  test('"Carregar mais" que falhou diz o erro, vira "Tentar de novo" e mantém a lista', async () => {
    const loadMore = vi.fn();
    useMyClosedConversations.mockReturnValue({
      items: [CLOSED_CONVERSATION], hasMore: true, loading: false, status: 'ready',
      loadMore, refresh: vi.fn(), erroAoCarregarMais: true,
    });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar mais atendimentos.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  test('erro da 1ª carga oferece "Tentar de novo"', async () => {
    const refresh = vi.fn();
    useMyClosedConversations.mockReturnValue({
      items: [], hasMore: false, loading: false, status: 'error', loadMore: vi.fn(), refresh, erroAoCarregarMais: false,
    });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('em carregamento não mostra "Nenhum atendimento encerrado"', () => {
    useMyClosedConversations.mockReturnValue({
      items: [],
      hasMore: false,
      loading: false,
      status: 'loading',
      loadMore: vi.fn(),
      refresh: vi.fn(),
    });
    render(<ClosedConversationsModal onClose={vi.fn()} />);

    expect(screen.queryByText(/nenhum atendimento encerrado/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('empilhamento da conversa aberta a partir de Encerrados', () => {
  test('a conversa abre numa camada acima do diálogo que a abriu', async () => {
    // O diálogo "Encerrados" é um portal no fim do <body>. Enquanto a conversa
    // era renderizada na árvore do #root, ficava atrás dele e clicar num
    // atendimento parecia não fazer nada.
    const { container } = render(<ClosedConversationsModal onClose={vi.fn()} />);

    await userEvent.click(screen.getByText('Ana Encerrada'));

    const camadaDaConversa = document.querySelector('[data-dialog="conversation"]');
    const camadaDeEncerrados = document.querySelector('[data-dialog="closed"]');

    expect(camadaDaConversa).toBeTruthy();
    // Fora da árvore do componente pai: foi para o portal no body.
    expect(container.contains(camadaDaConversa)).toBe(false);
    expect(document.body.contains(camadaDaConversa)).toBe(true);
    // E o tema escuro acompanha o portal, senão o modal sairia claro.
    expect(camadaDaConversa.closest('.chat-theme')).not.toBeNull();
    // A camada não é mais um número escrito à mão: vem da profundidade na
    // pilha. A conversa está um nível acima de quem a abriu, e o nível de
    // baixo fica inerte enquanto ela existir.
    const fundoDaConversa = camadaDaConversa.parentElement;
    const fundoDeEncerrados = camadaDeEncerrados.parentElement;
    expect(Number(fundoDaConversa.dataset.dialogDepth)).toBeGreaterThan(Number(fundoDeEncerrados.dataset.dialogDepth));
    expect(fundoDeEncerrados).toHaveAttribute('inert');
    expect(fundoDaConversa).not.toHaveAttribute('inert');

  });
});

// O popup guarda o item da lista no clique. Com o hook DE VERDADE: depois de
// salvar, fechar e reabrir o mesmo atendimento não pode trazer a nota antiga.
describe('Encerrados: reabrir não traz a nota antiga', () => {
  let encerradosReais;
  beforeAll(async () => {
    encerradosReais = await vi.importActual('../hooks/useMyClosedConversations');
  });

  const ENCERRADA = {
    id: 'c-old',
    contactId: 'contato-1',
    contactDisplayName: 'Ana Encerrada',
    contactInternalNote: 'Nota antiga',
    status: 'closed',
    closedAt: '2026-09-20T15:00:00.000Z',
    assignedAgentId: 'agent-1',
  };

  beforeEach(() => {
    useMyClosedConversations.mockImplementation(encerradosReais.useMyClosedConversations);
    api.getMyClosedConversations.mockResolvedValue({ items: [ENCERRADA], hasMore: false });
    api.listCities.mockResolvedValue([]);
    api.updateContact.mockReset();
    api.updateContact.mockResolvedValue({ id: 'contato-1', displayName: 'Ana Encerrada', cityId: null, localityId: null, internalNote: 'Nota nova' });
  });

  test('salvar, fechar a conversa e reabrir mostra e carrega a nota nova', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(await screen.findByText('Ana Encerrada'));
    await userEvent.click(screen.getByRole('button', { name: /^Editar cliente:/ }));
    const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
    const nota = within(edicao).getByLabelText('Nota interna');
    await userEvent.clear(nota);
    await userEvent.type(nota, 'Nota nova');
    await userEvent.click(within(edicao).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));
    expect(screen.queryByRole('dialog', { name: 'Conversa' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Ana Encerrada'));
    const conversa = screen.getByRole('dialog', { name: 'Conversa' });
    expect(within(within(conversa).getByRole('complementary')).getByText('Nota nova')).toBeInTheDocument();
    await userEvent.click(within(conversa).getByRole('button', { name: /^Editar cliente:/ }));
    expect(within(await screen.findByRole('dialog', { name: 'Editar cliente' })).getByLabelText('Nota interna')).toHaveValue('Nota nova');
  });
});

// Encerrados no celular: a conversa é só de leitura, mas os dados do cliente
// continuam acessíveis — pelo cabeçalho do popup, no lugar da conversa.
describe('Encerrados: Dados do cliente no celular', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('o cabeçalho dá acesso ao painel, que substitui a conversa com um único voltar', async () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('ResizeObserver', class {
      constructor(aoMedir) { this.aoMedir = aoMedir; }
      observe() { this.aoMedir([{ contentRect: { width: 390 } }]); }
      disconnect() {}
    });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('Ana Encerrada'));
    const conversa = screen.getByRole('dialog', { name: 'Conversa' });
    expect(within(conversa).queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();

    await userEvent.click(within(conversa).getByRole('button', { name: 'Dados do cliente' }));
    const painel = within(conversa).getByRole('complementary', { name: 'Dados do cliente' });
    expect(painel).toHaveClass('dados-cliente');
    expect(within(painel).getByText('Encerrado')).toBeInTheDocument();
    expect(within(conversa).getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
    expect(within(conversa).queryByPlaceholderText(/mensagem/i)).not.toBeInTheDocument();
    // Um controle só: o "×" do popup some enquanto o painel ocupa a tela…
    expect(within(conversa).queryByRole('button', { name: 'Fechar conversa' })).not.toBeInTheDocument();

    // …e volta com a conversa.
    await userEvent.click(within(conversa).getByRole('button', { name: 'Voltar à conversa' }));
    expect(within(conversa).getByRole('button', { name: 'Fechar conversa' })).toBeInTheDocument();
  });
});
