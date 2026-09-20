import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClosedConversationsModal from './ClosedConversationsModal';
import { useMyClosedConversations } from '../hooks/useMyClosedConversations';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../hooks/useMyClosedConversations');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');

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

    const camadaDaConversa = screen.getAllByRole('dialog').find((el) => el.className.includes('dialog-conversation'));

    expect(camadaDaConversa).toBeTruthy();
    // Fora da árvore do componente pai: foi para o portal no body.
    expect(container.contains(camadaDaConversa)).toBe(false);
    expect(document.body.contains(camadaDaConversa)).toBe(true);
    // E o tema escuro acompanha o portal, senão o modal sairia claro.
    expect(camadaDaConversa.closest('.chat-theme')).not.toBeNull();
    expect(camadaDaConversa.parentElement.className).toContain('z-[60]');
  });
});
