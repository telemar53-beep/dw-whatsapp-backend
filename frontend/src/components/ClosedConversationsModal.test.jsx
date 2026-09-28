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
  getConversationHistory: vi.fn(() => new Promise(() => {})),
}));

// Dados fictícios.
const ENCERRADA = {
  id: 'c-old',
  contactId: 'contato-1',
  contactDisplayName: 'Cliente 101',
  contactPhoneNumber: '5500000000001',
  contactInternalNote: 'Nota antiga',
  status: 'closed',
  closedAt: '2026-09-20T15:00:00.000Z',
  assignedAgentId: 'agent-1',
  sectorName: 'Suporte',
  channelName: 'Canal Exemplo',
  lastMessageContent: 'Obrigado pelo atendimento!',
};
const OUTRA = { ...ENCERRADA, id: 'c-2', contactId: 'contato-2', contactDisplayName: 'Cliente 102', contactInternalNote: null };

function listaPronta(extra = {}) {
  useMyClosedConversations.mockReturnValue({
    items: [ENCERRADA, OUTRA],
    hasMore: false,
    loading: false,
    status: 'ready',
    loadMore: vi.fn(),
    refresh: vi.fn(),
    erroAoCarregarMais: false,
    aplicarContatoSalvo: vi.fn(),
    ...extra,
  });
}

// Largura de celular: o jsdom não mede nada, então a conversa recebe a medida
// por um ResizeObserver de mentira, e a tela responde pela largura pedida.
function largura(px) {
  vi.stubGlobal('innerWidth', px);
  vi.stubGlobal('matchMedia', (consulta) => {
    const max = /max-width:\s*(\d+)px/.exec(consulta);
    return { matches: Boolean(max) && px <= Number(max[1]), media: consulta, addEventListener() {}, removeEventListener() {} };
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(aoMedir) { this.aoMedir = aoMedir; }
    observe() { this.aoMedir([{ contentRect: { width: px } }]); }
    disconnect() {}
  });
}

const dialogo = () => screen.getByRole('dialog', { name: /Atendimentos encerrados/ });
const linha = (nome) => screen.getByRole('button', { name: new RegExp(nome) });

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  listaPronta();
});
afterEach(() => vi.unstubAllGlobals());

describe('Encerrados: a lista', () => {
  test('claro, com a lista do atendente e a contagem no título', () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(dialogo()).toHaveClass('mc');
    expect(within(dialogo()).getByRole('heading', { level: 2 })).toHaveTextContent('Atendimentos encerrados, 2');
    expect(dialogo()).toHaveAccessibleName(/^Atendimentos encerrados\s*,\s*2$/);
    expect(linha('Cliente 101')).toHaveTextContent('Obrigado pelo atendimento!');
    expect(linha('Cliente 101')).toHaveTextContent('Suporte');
    expect(document.querySelector('[data-dialog-close]')).toBeNull();
  });

  test('Escape e "Fechar" fecham o diálogo', async () => {
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('clicking Carregar mais calls loadMore', async () => {
    const loadMore = vi.fn();
    listaPronta({ hasMore: true, loadMore });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(within(dialogo()).getByRole('heading', { level: 2 })).toHaveTextContent('2+');
    await userEvent.click(screen.getByRole('button', { name: /carregar mais/i }));
    expect(loadMore).toHaveBeenCalled();
  });

  // CVM-ENC-11: antes o erro do "Carregar mais" voltava calado.
  test('"Carregar mais" que falhou diz o erro, vira "Tentar de novo" e mantém a lista', async () => {
    const loadMore = vi.fn();
    listaPronta({ hasMore: true, loadMore, erroAoCarregarMais: true });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar mais atendimentos.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(linha('Cliente 101')).toBeInTheDocument();
  });

  test('erro da 1ª carga oferece "Tentar de novo"', async () => {
    const refresh = vi.fn();
    listaPronta({ items: [], status: 'error', refresh });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os atendimentos encerrados.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('em carregamento não mostra "Nenhum atendimento encerrado"', () => {
    listaPronta({ items: [], status: 'loading', loading: true });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.queryByText(/nenhum atendimento encerrado/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando os atendimentos…');
  });

  test('lista vazia diz que não há nenhum', () => {
    listaPronta({ items: [] });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByText('Nenhum atendimento encerrado ainda.')).toBeInTheDocument();
  });

  test('sem permissão, diz — sem fingir lista vazia', () => {
    listaPronta({ items: [], status: 'forbidden' });
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByText('Você não tem permissão para ver esta lista.')).toBeInTheDocument();
    expect(screen.queryByText(/nenhum atendimento encerrado/i)).not.toBeInTheDocument();
  });
});

describe('Encerrados no desktop: lista à esquerda, conversa à direita', () => {
  test('sem escolha, a direita orienta; ao escolher, a conversa abre no mesmo diálogo, só de leitura', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    expect(screen.getByText('Escolha um atendimento na lista para ler a conversa.')).toBeInTheDocument();

    await userEvent.click(linha('Cliente 101'));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(linha('Cliente 101')).toHaveAttribute('aria-current', 'true');
    expect(linha('Cliente 101')).toHaveFocus();
    const conversa = document.querySelector('.ae-conversa');
    expect(within(conversa.querySelector('.ae-cab')).getByRole('heading', { name: 'Cliente 101' })).toBeInTheDocument();
    // A lista continua ali, ao lado.
    expect(linha('Cliente 102')).toBeInTheDocument();
    // Só de leitura: sem compositor, transferir ou encerrar.
    expect(screen.queryByPlaceholderText(/mensagem/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /encerrar/i })).not.toBeInTheDocument();
    expect(within(conversa).getByText(/Atendimento encerrado em/)).toBeInTheDocument();
    // A conversa aprovada (clara), e não uma segunda conversa.
    expect(conversa).toHaveClass('mesa-conversa');
    expect(conversa.querySelector('.conv-raiz')).not.toBeNull();
  });

  test('Dados do cliente à vista ao lado da conversa, com Encerrado em; Histórico dentro dele', async () => {
    largura(1366);
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(linha('Cliente 101'));
    const painel = screen.getByRole('complementary', { name: 'Dados do cliente' });
    expect(within(painel).getByText('Encerrado')).toBeInTheDocument();
    expect(within(painel).getByText('Nota antiga')).toBeInTheDocument();
    await userEvent.click(within(painel).getByRole('button', { name: 'Dados do atendimento' }));
    expect(within(painel).getByText('Encerrado em')).toBeInTheDocument();
    expect(within(painel).queryByRole('button', { name: /Fechar dados do cliente|Voltar à conversa/ })).not.toBeInTheDocument();
    expect(within(painel).getByRole('button', { name: 'Histórico' })).toBeInTheDocument();
  });

  test('trocar de atendimento na lista troca a conversa aberta', async () => {
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(linha('Cliente 101'));
    await userEvent.click(linha('Cliente 102'));
    const conversa = document.querySelector('.ae-conversa');
    expect(within(conversa.querySelector('.ae-cab')).getByRole('heading', { name: 'Cliente 102' })).toBeInTheDocument();
    expect(linha('Cliente 102')).toHaveAttribute('aria-current', 'true');
    expect(linha('Cliente 101')).not.toHaveAttribute('aria-current');
  });

  test('o painel do SGP abre dentro do diálogo; o Escape ainda fecha tudo, como antes', async () => {
    largura(1366);
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);
    await userEvent.click(linha('Cliente 101'));
    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    const sgp = await screen.findByRole('region', { name: 'Consulta SGP' });
    expect(dialogo()).toContainElement(sgp);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Histórico abre por cima; o Escape fecha só ele e o foco volta ao botão', async () => {
    largura(1366);
    api.getConversationHistory.mockResolvedValue([
      { id: 'at-1', status: 'closed', createdAt: '2026-09-21T14:30:00', closeReasonName: 'Sem conexão', channelName: 'Canal Exemplo' },
    ]);
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);
    await userEvent.click(linha('Cliente 101'));
    const historico = within(screen.getByRole('complementary', { name: 'Dados do cliente' })).getByRole('button', { name: 'Histórico' });
    await userEvent.click(historico);
    expect(await screen.findByRole('dialog', { name: 'Histórico de atendimentos' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Histórico de atendimentos' })).not.toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(historico).toHaveFocus();
  });
});

describe('Encerrados no celular: a lista, depois a conversa em tela cheia', () => {
  test('a conversa toma a tela com a seta "Voltar para a lista" como única saída, e o foco vai para ela', async () => {
    largura(390);
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);
    expect(dialogo()).toHaveClass('is-celular');
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();

    await userEvent.click(linha('Cliente 101'));
    const voltar = screen.getByRole('button', { name: 'Voltar para a lista' });
    await waitFor(() => expect(voltar).toHaveFocus());
    // A lista e o cabeçalho dela saem de cena: um controle só.
    expect(screen.queryByRole('button', { name: /Cliente 102/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();

    await userEvent.click(voltar);
    expect(linha('Cliente 101')).toBeInTheDocument();
    await waitFor(() => expect(linha('Cliente 101')).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Dados do cliente no lugar da conversa: só o voltar do painel; Escape volta um passo por vez', async () => {
    largura(390);
    const onClose = vi.fn();
    render(<ClosedConversationsModal onClose={onClose} />);
    await userEvent.click(linha('Cliente 101'));
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));

    const painel = screen.getByRole('complementary', { name: 'Dados do cliente' });
    expect(within(painel).getByText('Encerrado')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Voltar à conversa' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Voltar para a lista' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Dados do cliente' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dados do cliente' })).toHaveFocus());

    await userEvent.keyboard('{Escape}');
    expect(linha('Cliente 101')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Histórico à vista no cabeçalho da conversa', async () => {
    largura(390);
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(linha('Cliente 101'));
    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByRole('dialog', { name: 'Histórico de atendimentos' })).toBeInTheDocument();
  });
});

// O item aberto vem da lista (pelo id): com o hook DE VERDADE, o que o
// "Editar cliente" salvou vai para a lista, e reabrir não traz a nota antiga.
describe('Encerrados: reabrir não traz a nota antiga', () => {
  let encerradosReais;
  beforeAll(async () => {
    encerradosReais = await vi.importActual('../hooks/useMyClosedConversations');
  });

  beforeEach(() => {
    useMyClosedConversations.mockImplementation(encerradosReais.useMyClosedConversations);
    api.getMyClosedConversations.mockResolvedValue({ items: [ENCERRADA], hasMore: false });
    api.listCities.mockResolvedValue([]);
    api.updateContact.mockReset();
    api.updateContact.mockResolvedValue({ id: 'contato-1', displayName: 'Cliente 101', cityId: null, localityId: null, internalNote: 'Nota nova' });
  });

  test('salvar, voltar à lista e reabrir mostra e carrega a nota nova', async () => {
    largura(390);
    render(<ClosedConversationsModal onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Cliente 101/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar cliente' }));
    const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
    const nota = within(edicao).getByLabelText('Nota interna');
    await userEvent.clear(nota);
    await userEvent.type(nota, 'Nota nova');
    await userEvent.click(within(edicao).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Voltar à conversa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    await userEvent.click(screen.getByRole('button', { name: /Cliente 101/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    const painel = screen.getByRole('complementary', { name: 'Dados do cliente' });
    expect(within(painel).getByText('Nota nova')).toBeInTheDocument();
    await userEvent.click(within(painel).getByRole('button', { name: 'Editar cliente' }));
    expect(within(await screen.findByRole('dialog', { name: 'Editar cliente' })).getByLabelText('Nota interna')).toHaveValue('Nota nova');
  });
});
