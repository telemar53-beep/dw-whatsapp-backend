import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { VARIANTE_DA_MESA } from './ConversaDaMesa';
import { PAINEL } from '../hooks/useWorkspaceLayout';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { usePlaces } from '../hooks/useCities';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// O painel "Dados do cliente" dentro da conversa (mesa). Dados fictícios.
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSgpLookup');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');

const A = { id: 'conv-A', contactId: 'contato-A', contactDisplayName: 'Contato A', contactInternalNote: 'Nota de A', status: 'assigned', assignedAgentId: 'agent-1' };
const B = { id: 'conv-B', contactId: 'contato-B', contactDisplayName: 'Contato B', contactInternalNote: 'Nota de B', status: 'assigned', assignedAgentId: 'agent-1' };

const naMesa = (conversa, props = {}) => (
  <ConversationView conversation={conversa} onTransferClick={vi.fn()} onBack={vi.fn()} workspace variante={VARIANTE_DA_MESA} {...props} />
);
const painel = () => screen.queryByRole('complementary', { name: 'Dados do cliente' });
const botaoDados = () => screen.getByRole('button', { name: 'Dados do cliente' });

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
  useReasons.mockReturnValue({ reasons: [], loading: false, refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useSgpLookup.mockReturnValue({ client: null, contracts: [], loading: false, error: null, search: vi.fn(), fetchDuplicate: vi.fn(), duplicateState: {} });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
});

describe('Dados do cliente na mesa', () => {
  test('não existe no DOM até o clique, e fechar desmonta de novo', async () => {
    render(naMesa(A));
    expect(painel()).toBeNull();
    expect(document.querySelector('#conv-painel-cliente')).toBeNull();

    await userEvent.click(botaoDados());
    expect(painel()).toHaveClass('dados-cliente');
    expect(botaoDados()).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(within(painel()).getByRole('button', { name: 'Fechar dados do cliente' }));
    expect(painel()).toBeNull();
    expect(document.querySelector('#conv-painel-cliente')).toBeNull();
  });

  test('abrir Dados fecha o SGP, e abrir o SGP fecha Dados', async () => {
    render(naMesa(A));
    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();

    await userEvent.click(botaoDados());
    expect(painel()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Consulta SGP' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Consultar SGP' }));
    expect(await screen.findByRole('region', { name: 'Consulta SGP' })).toBeInTheDocument();
    expect(painel()).toBeNull();
  });

  test('trocar de conversa fecha o painel', async () => {
    const { rerender } = render(naMesa(A));
    await userEvent.click(botaoDados());
    expect(within(painel()).getByText('Nota de A')).toBeInTheDocument();
    rerender(naMesa(B));
    expect(painel()).toBeNull();
  });

  test('Escape fecha o painel e o foco volta ao botão de origem', async () => {
    render(naMesa(A));
    await userEvent.click(botaoDados());
    expect(painel()).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(painel()).toBeNull();
    expect(botaoDados()).toHaveFocus();
  });

  test('Editar cliente e Histórico abrem os modais que já existiam', async () => {
    api.getConversationHistory.mockResolvedValue([]);
    render(naMesa(A));
    await userEvent.click(botaoDados());
    await userEvent.click(within(painel()).getByRole('button', { name: 'Editar cliente' }));
    const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
    expect(within(edicao).getByLabelText('Nota interna')).toHaveValue('Nota de A');
    await userEvent.click(within(edicao).getByRole('button', { name: 'Cancelar' }));

    await userEvent.click(within(painel()).getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByRole('dialog', { name: 'Histórico de atendimentos' })).toBeInTheDocument();
    expect(api.getConversationHistory).toHaveBeenCalled();
  });
});

describe('Dados do cliente no celular da mesa (substitui a conversa)', () => {
  test('um único controle de voltar, e o foco volta ao botão depois que a conversa reaparece', async () => {
    render(naMesa(A, { painelModo: 'alternado' }));
    await userEvent.click(botaoDados());
    const raiz = document.querySelector('.conv-raiz');
    expect(raiz).toHaveClass('is-painel-alternado');

    const voltar = screen.getAllByRole('button', { name: 'Voltar à conversa' });
    expect(voltar).toHaveLength(1);
    expect(within(painel()).queryByRole('button', { name: 'Fechar dados do cliente' })).not.toBeInTheDocument();
    expect(voltar[0]).toHaveFocus();

    await userEvent.click(voltar[0]);
    expect(painel()).toBeNull();
    expect(raiz).not.toHaveClass('is-painel-alternado');
    await waitFor(() => expect(botaoDados()).toHaveFocus());
  });
});

describe('estado canônico da conversa', () => {
  test.each([
    [{ status: 'assigned', assignedAgentId: 'agent-1' }, 'Em atendimento'],
    [{ status: 'waiting', assignedAgentId: null }, 'Em espera'],
    [{ status: 'waiting', assignedAgentId: null, triageState: 'pending' }, 'Em automação'],
    [{ status: 'silent', assignedAgentId: null }, 'Silenciada'],
    [{ status: 'closed', assignedAgentId: 'agent-1' }, 'Encerrado'],
  ])('%o: o painel diz o mesmo que o cabeçalho — "%s"', async (campos, rotulo) => {
    render(naMesa({ ...A, ...campos }));
    await userEvent.click(botaoDados());
    expect(within(painel()).getByText(rotulo)).toBeInTheDocument();
    expect(screen.getAllByText(rotulo).length).toBe(2);
  });
});

// A largura mora no CSS do encaixe (o jsdom não calcula layout): o mesmo
// encaixe de 300 px para o SGP e para Dados — alternar os dois não faz a
// conversa pular — e é o mesmo valor que a regra de larguras reserva.
test('o encaixe tem 300 px para os dois painéis, igual à regra de larguras', () => {
  const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
  const css = readFileSync(join(RAIZ, 'components/conversa-painel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const larguras = [...css.matchAll(/(?:^|\n)([^{}\n]*conv-painel-slot[^{}]*)\{([^}]*)\}/g)]
    .map(([, seletor, corpo]) => [seletor.trim(), (corpo.match(/(?:^|;)\s*width:\s*([^;]+)/) || [])[1]])
    .filter(([, largura]) => largura);
  expect(larguras).toEqual([['.conv-raiz > .conv-painel-slot', '300px'], ['.conv-raiz.is-painel-alternado > .conv-painel-slot', '100%']]);
  expect(PAINEL).toBe(300);
});

// O modal de edição (sob demanda) abre com o foco no Nome e, ao sair, devolve o
// foco ao botão que o abriu.
test('Editar cliente: foco no Nome ao abrir e de volta no botão ao cancelar', async () => {
  render(naMesa(A));
  await userEvent.click(botaoDados());
  const editar = within(painel()).getByRole('button', { name: 'Editar cliente' });
  await userEvent.click(editar);
  const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
  await waitFor(() => expect(within(edicao).getByLabelText('Nome')).toHaveFocus());
  await userEvent.click(within(edicao).getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument();
  expect(editar).toHaveFocus();
});
