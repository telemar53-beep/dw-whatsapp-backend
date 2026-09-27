import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationModal from './ConversationModal';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../contexts/AuthContext');
// Só o que a edição do contato e o painel ao lado chamam; o resto da API
// continua a de verdade, como nos testes que já existiam aqui. As listas ficam
// pendentes por padrão, como a chamada real ficava no jsdom.
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  updateContact: vi.fn(),
  listCities: vi.fn(() => new Promise(() => {})),
  listSectors: vi.fn(() => new Promise(() => {})),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
});

describe('ConversationModal', () => {
  test('renders the conversation inside a dialog', () => {
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={vi.fn()} onTransferClick={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Carlos').length).toBeGreaterThan(0);
  });

  // O "x" proprio era `hidden md:flex`: no celular a conversa aberta por cima
  // de outro dialogo nao tinha botao de fechar nenhum. O da base aparece em
  // qualquer largura, porque nao depende de media query.
  test('o botao fechar existe e nao depende da largura da tela', async () => {
    const onClose = vi.fn();
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={onClose} onTransferClick={vi.fn()} />);

    const fechar = screen.getByRole('button', { name: 'Fechar conversa' });
    expect(fechar).toHaveAttribute('data-dialog-close');
    expect(fechar.className).not.toMatch(/(hidden|md:flex|sm:flex|lg:flex)/);

    await userEvent.click(fechar);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Supervisão e Encerrados abrem a conversa neste modal, fora da mesa: o
  // painel do SGP funciona aqui também, com o encaixe e o CSS dele.
  test('o painel do SGP abre dentro do modal, fora da mesa', async () => {
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={vi.fn()} onTransferClick={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    const painel = await screen.findByRole('region', { name: 'Consulta SGP' });
    expect(within(screen.getByRole('dialog')).getByRole('region', { name: 'Consulta SGP' })).toBe(painel);
    expect(within(painel).getByLabelText('CPF ou CNPJ do cliente')).toBeInTheDocument();
    expect(painel.closest('#conv-painel-sgp')).toHaveClass('conv-painel-slot', 'is-sgp');
  });

  test('closing via the conversation view\'s back button calls onClose', async () => {
    const onClose = vi.fn();
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={onClose} onTransferClick={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(onClose).toHaveBeenCalled();
  });

  test('clicking the transfer icon calls onTransferClick with the conversation id', async () => {
    const onTransferClick = vi.fn();
    const conversation = { id: 'c1', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };
    render(<ConversationModal conversation={conversation} onClose={vi.fn()} onTransferClick={onTransferClick} />);

    await userEvent.click(screen.getByRole('button', { name: /transferir atendimento/i }));

    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });
});

// Supervisão e Encerrados: a conversa e o painel ao lado recebem a mesma
// conversa, e nenhum dos dois fica sabendo da edição pela lista (a rota não
// emite evento). O que o "Editar cliente" salvou tem de chegar ao painel.
describe('edição do contato dentro do modal', () => {
  const EM_ATENDIMENTO = {
    id: 'c1',
    contactId: 'contato-1',
    contactDisplayName: 'Contato Um',
    contactInternalNote: 'Nota antiga',
    assignedAgentId: 'agent-1',
    assignedAgentName: 'Atendente A',
    status: 'assigned',
    sectorId: 'setor-1',
    sectorName: 'Suporte',
  };

  const mostrar = (conversa) => render(<ConversationModal conversation={conversa} onClose={vi.fn()} onTransferClick={vi.fn()} />);
  const edicao = () => screen.getByRole('dialog', { name: 'Editar cliente' });
  async function salvarNomeENota(nome, nota) {
    await userEvent.click(screen.getByRole('button', { name: /^Editar cliente:/ }));
    // O modal de edição chega sob demanda.
    await screen.findByRole('dialog', { name: 'Editar cliente' });
    for (const [rotulo, texto] of [['Nome', nome], ['Nota interna', nota]]) {
      const campo = within(edicao()).getByLabelText(rotulo);
      await userEvent.clear(campo);
      await userEvent.type(campo, texto);
    }
    await userEvent.click(within(edicao()).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());
  }

  beforeEach(() => {
    // clearAllMocks não esvazia a fila de mockResolvedValueOnce: a resposta
    // que um teste não consumiu iria para o seguinte.
    api.updateContact.mockReset();
    api.listCities.mockResolvedValue([]);
  });

  test('Supervisão: o painel ao lado mostra o que acabou de ser salvo na mesma conversa', async () => {
    api.updateContact.mockResolvedValue({ id: 'contato-1', displayName: 'Contato Renomeado', cityId: null, localityId: null, internalNote: 'Nota nova' });
    mostrar(EM_ATENDIMENTO);
    const painel = screen.getByRole('complementary');
    expect(within(painel).getByText('Nota antiga')).toBeInTheDocument();

    await salvarNomeENota('Contato Renomeado', 'Nota nova');

    expect(within(painel).getByText('Contato Renomeado')).toBeInTheDocument();
    expect(within(painel).getByText('Nota nova')).toBeInTheDocument();
    expect(within(painel).queryByText('Nota antiga')).not.toBeInTheDocument();
  });

  test('Encerrados: a conversa continua só de leitura, com "Encerrado em", e a edição chega ao painel', async () => {
    api.updateContact.mockResolvedValue({ id: 'contato-1', displayName: 'Contato Renomeado', cityId: null, localityId: null, internalNote: 'Nota nova' });
    mostrar({ ...EM_ATENDIMENTO, status: 'closed', closedAt: '2026-09-20T15:00:00.000Z' });
    const painel = screen.getByRole('complementary');

    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
    expect(within(painel).getByText('Encerrado')).toBeInTheDocument();
    await userEvent.click(within(painel).getByRole('button', { name: 'Dados do atendimento' }));
    expect(within(painel).getByText('Encerrado em')).toBeInTheDocument();

    await salvarNomeENota('Contato Renomeado', 'Nota nova');

    expect(within(painel).getByText('Nota nova')).toBeInTheDocument();
    expect(within(painel).getByText('Encerrado em')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
  });

  // Quem edita o contato e quem troca o setor: exatamente como antes da
  // correção. Editar o contato continua aberto a qualquer atendente (decisão de
  // produto em aberto); o setor, só o responsável, gerente e admin.
  test.each([
    ['atendente que não é o responsável', { id: 'agent-2', role: 'agent' }, false],
    ['responsável pela conversa', { id: 'agent-1', role: 'agent' }, true],
    ['gerente', { id: 'gerente-1', role: 'manager' }, true],
    ['admin', { id: 'admin-1', role: 'admin' }, true],
  ])('permissões inalteradas: %s', async (_quem, agent, trocaSetor) => {
    useAuth.mockReturnValue({ token: 'tok-123', agent });
    mostrar(EM_ATENDIMENTO);
    await userEvent.click(screen.getByRole('button', { name: 'Dados do atendimento' }));
    expect(screen.getByRole('button', { name: /^Editar cliente:/ })).toBeInTheDocument();
    if (trocaSetor) expect(screen.getByLabelText('Alterar setor')).toBeInTheDocument();
    else expect(screen.queryByLabelText('Alterar setor')).not.toBeInTheDocument();
  });
});

// Largura de celular: o jsdom não mede nada, então a conversa recebe a medida
// por um ResizeObserver de mentira, e a janela, a mesma largura.
function telaDeCelular(largura = 390) {
  vi.stubGlobal('innerWidth', largura);
  vi.stubGlobal('ResizeObserver', class {
    constructor(aoMedir) { this.aoMedir = aoMedir; }
    observe() { this.aoMedir([{ contentRect: { width: largura } }]); }
    disconnect() {}
  });
}

// O popup da Supervisão e dos Encerrados usa o mesmo painel da mesa, dentro da
// conversa: no desktop, à vista o tempo todo; no celular, pelo cabeçalho, no
// lugar da conversa.
describe('Dados do cliente no popup', () => {
  afterEach(() => vi.unstubAllGlobals());
  const CONVERSA = { id: 'c1', contactId: 'contato-1', contactDisplayName: 'Contato Um', contactInternalNote: 'Nota do contato', assignedAgentId: 'agent-1', status: 'assigned' };
  const mostrar = () => render(<ConversationModal conversation={CONVERSA} onClose={vi.fn()} onTransferClick={vi.fn()} />);

  test('desktop: o mesmo painel da mesa, à vista, e nenhum painel antigo com layout próprio', () => {
    mostrar();
    const paineis = screen.getAllByRole('complementary');
    expect(paineis).toHaveLength(1);
    expect(paineis[0]).toHaveAccessibleName('Dados do cliente');
    expect(paineis[0]).toHaveClass('dados-cliente');
    expect(document.querySelector('.dialog-conversation-info')).toBeNull();
    // Acesso contínuo: nem fechar nem voltar.
    expect(within(paineis[0]).queryByRole('button', { name: /Fechar dados do cliente|Voltar à conversa/ })).not.toBeInTheDocument();
    // O fechar do popup continua como sempre no desktop.
    expect(screen.getByRole('button', { name: 'Fechar conversa' })).toBeInTheDocument();
  });

  test('celular: o cabeçalho dá acesso, o painel substitui a conversa e um único voltar devolve o foco', async () => {
    telaDeCelular();
    mostrar();
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' })).toBeInTheDocument();
    expect(document.querySelector('.conv-raiz')).toHaveClass('is-painel-alternado');
    const voltar = screen.getAllByRole('button', { name: 'Voltar à conversa' });
    expect(voltar).toHaveLength(1);

    await userEvent.click(voltar[0]);
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dados do cliente' })).toHaveFocus());
  });
});

// Celular: quando um painel ocupa o lugar da conversa no popup, o único
// controle é o voltar do painel — o "×" do popup some e só volta com a
// conversa. O Escape segue a mesma ordem: primeiro volta do painel, depois
// fecha o popup.
describe('popup no celular: um controle só com o painel no lugar da conversa', () => {
  afterEach(() => vi.unstubAllGlobals());
  const CONVERSA = { id: 'c1', contactId: 'contato-1', contactDisplayName: 'Contato Um', assignedAgentId: 'agent-1', status: 'assigned' };

  test('Dados do cliente: só o voltar; ao voltar, o "×" reaparece e fecha o popup', async () => {
    telaDeCelular();
    const onClose = vi.fn();
    render(<ConversationModal conversation={CONVERSA} onClose={onClose} onTransferClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Fechar conversa' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    expect(screen.getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Fechar conversa' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }));
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar conversa' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape: com o painel no lugar da conversa, volta à conversa; depois, fecha o popup', async () => {
    telaDeCelular();
    const onClose = vi.fn();
    render(<ConversationModal conversation={CONVERSA} onClose={onClose} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dados do cliente' })).toHaveFocus());

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('SGP no lugar da conversa: também só o voltar do painel', async () => {
    telaDeCelular();
    render(<ConversationModal conversation={CONVERSA} onClose={vi.fn()} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Fechar conversa' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }));
    expect(screen.getByRole('button', { name: 'Fechar conversa' })).toBeInTheDocument();
  });

  test('desktop: com o SGP aberto ao lado, o "×" continua e o Escape fecha o popup, como antes', async () => {
    const onClose = vi.fn();
    render(<ConversationModal conversation={CONVERSA} onClose={onClose} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar conversa' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
