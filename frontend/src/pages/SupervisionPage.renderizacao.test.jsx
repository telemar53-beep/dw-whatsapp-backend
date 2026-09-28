import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from './SupervisionPage';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import { getDashboardConversations, getDashboardClosedToday, getPublicCompany } from '../services/api';

// Custo de um evento na Supervisão (achado da auditoria de 27/09): cada
// `dashboard:conversation` redesenhava TODAS as linhas. Aqui o hook do painel
// é o de verdade, alimentado por um socket falso, e a sonda conta quantas
// vezes cada linha desenhou — a foto do contato só desenha quando a linha
// dela desenha (a linha é memo; a foto, não).

const rendersPorContato = vi.hoisted(() => new Map());
vi.mock('../components/ContactAvatar', () => ({
  default: function SondaDaFoto({ contactId }) {
    rendersPorContato.set(contactId, (rendersPorContato.get(contactId) || 0) + 1);
    return <span data-sonda-foto={contactId} />;
  },
}));
vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

function socketFalso() {
  const ouvintes = {};
  return {
    on: vi.fn((evento, fn) => { (ouvintes[evento] ||= new Set()).add(fn); }),
    off: vi.fn((evento, fn) => { ouvintes[evento]?.delete(fn); }),
    emit: vi.fn(),
    disparar(evento, dados) { ouvintes[evento]?.forEach((fn) => fn(dados)); },
  };
}

const haMin = (m) => new Date(Date.now() - m * 60000).toISOString();
const conversa = (n, extra) => ({
  id: `c${n}`, contactId: `ct${n}`, contactDisplayName: `Cliente ${100 + n}`, contactPhoneNumber: `55000000000${n}`,
  protocolNumber: `20260927-00${n}`, channelId: 'chan-1', sectorId: 'sector-1', sectorName: 'Suporte',
  createdAt: haMin(30 - n), lastMessageAt: haMin(20 - n), lastMessageContent: `mensagem ${n}`, ...extra,
});
const ESPERA = [1, 2, 3].map((n) => conversa(n, { status: 'waiting', assignedAgentId: null }));
const ATENDIMENTO = [4, 5, 6, 7].map((n) => conversa(n, { status: 'assigned', assignedAgentId: 'agent-1' }));
const AUTOMACAO = [8].map((n) => conversa(n, { status: 'waiting', triageState: 'pending', assignedAgentId: null }));
const TODAS = [...ESPERA, ...ATENDIMENTO, ...AUTOMACAO];

const AGENTES = [{ id: 'agent-1', name: 'Atendente A', online: true }, { id: 'agent-2', name: 'Atendente B', online: false }];
// Como a lista volta do servidor quando o botão "Equipe" do trilho a busca de
// novo (TeamPanel, a cada dashboard:conversation): objetos novos, mesmos nomes.
const AGENTES_BUSCADOS_DE_NOVO = () => AGENTES.map((a) => ({ ...a, activeConversations: 3 }));

let socket;
beforeEach(() => {
  vi.clearAllMocks();
  rendersPorContato.clear();
  socket = socketFalso();
  useSocket.mockReturnValue(socket);
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'agent-9', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'Canal Um' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: AGENTES, status: 'ready' });
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Suporte' }], loading: false, refresh: vi.fn() });
  getDashboardConversations.mockResolvedValue({ inProgress: ATENDIMENTO, waiting: ESPERA, inAutomation: AUTOMACAO, closedTodayCount: 0 });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  getPublicCompany.mockResolvedValue({ name: '' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
});

async function montar() {
  renderInShell(<SupervisionPage />, { path: '/supervisao' });
  await screen.findByRole('button', { name: /Cliente 101/ });
  return new Map(rendersPorContato);
}
const lista = () => screen.getByRole('region', { name: /^Conversas/ });
const mudou = (antes) => [...rendersPorContato].filter(([id, n]) => n !== antes.get(id)).map(([id]) => id).sort();

describe('evento de uma conversa só redesenha a linha dela', () => {
  test('nova mensagem na Espera: só a linha da conversa desenha de novo', async () => {
    const antes = await montar();
    expect(antes.size).toBe(TODAS.length);
    act(() => socket.disparar('dashboard:conversation', { conversation: { ...ESPERA[1], lastMessageContent: 'chegou agora' } }));
    expect(within(lista()).getByRole('button', { name: /Cliente 102/ })).toHaveTextContent('chegou agora');
    expect(mudou(antes)).toEqual(['ct2']);
  });

  test('conversa assumida sai da Espera e entra no atendimento sem redesenhar as outras', async () => {
    const antes = await montar();
    act(() => socket.disparar('dashboard:conversation', { conversation: { ...ESPERA[0], status: 'assigned', assignedAgentId: 'agent-1' } }));
    const atendimento = within(lista()).getByRole('heading', { level: 3, name: 'Em atendimento' }).closest('section');
    expect(within(atendimento).getByRole('button', { name: /Cliente 101/ })).toHaveTextContent('Atendente A');
    expect(mudou(antes)).toEqual(['ct1']);
  });

  test('evento repetido com o mesmo objeto não redesenha linha nenhuma', async () => {
    const antes = await montar();
    act(() => socket.disparar('dashboard:conversation', { conversation: ESPERA[2] }));
    expect(mudou(antes)).toEqual([]);
  });

  test('presença da equipe muda o painel da equipe e nenhuma linha', async () => {
    const antes = await montar();
    act(() => socket.disparar('presence:online', { agentId: 'agent-2' }));
    const equipe = screen.getByRole('complementary', { name: 'Equipe' });
    await waitFor(() => expect(within(equipe).getByText('2 online')).toBeInTheDocument());
    expect(mudou(antes)).toEqual([]);
  });

  // No navegador, cada evento também faz o trilho buscar /api/agents de novo
  // (medido em 27/09: 11 de 10 linhas redesenhavam por evento).
  test('lista de atendentes buscada de novo, com os mesmos nomes, não redesenha linha nenhuma', async () => {
    const antes = await montar();
    useAgents.mockReturnValue({ agents: AGENTES_BUSCADOS_DE_NOVO(), status: 'ready' });
    act(() => socket.disparar('dashboard:conversation', { conversation: { ...ESPERA[1], lastMessageContent: 'chegou agora' } }));
    expect(within(lista()).getByRole('button', { name: /Cliente 102/ })).toHaveTextContent('chegou agora');
    expect(mudou(antes)).toEqual(['ct2']);
  });

  test('atendente renomeado atualiza as linhas dele', async () => {
    await montar();
    useAgents.mockReturnValue({ agents: [{ ...AGENTES[0], name: 'Beatriz Souza' }, AGENTES[1]], status: 'ready' });
    act(() => socket.disparar('presence:online', { agentId: 'agent-2' }));
    const atendimento = within(lista()).getByRole('heading', { level: 3, name: 'Em atendimento' }).closest('section');
    await waitFor(() => expect(within(atendimento).getAllByRole('button')[0]).toHaveTextContent('Beatriz'));
  });

  test('digitar na busca não redesenha as linhas que continuam na tela', async () => {
    const antes = await montar();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Buscar cliente, telefone ou protocolo' }), 'Cliente 10');
    expect(within(lista()).getAllByRole('listitem')).toHaveLength(TODAS.length);
    expect(mudou(antes)).toEqual([]);
  });
});

// A conversa aberta no popup é a mesma ConversationView da mesa. Aqui só a
// ConversationView chama useQuickReplies, uma vez por render (como no teste
// A2 da mesa): as chamadas contam os renders do popup.
//
// O popup termina de montar com efeitos assíncronos próprios (camada do
// diálogo, empresa, mídia). A medida começa quando a contagem para de subir
// sem evento nenhum — senão o assentamento se passaria por custo do evento.
async function assentarPopup() {
  let anterior = -1;
  while (anterior !== useQuickReplies.mock.calls.length) {
    anterior = useQuickReplies.mock.calls.length;
    await act(() => new Promise((r) => setTimeout(r, 30)));
  }
  return anterior;
}

describe('evento de outra conversa não redesenha o popup aberto', () => {
  test('popup de uma conversa, evento de outra: o popup fica parado e a linha da outra atualiza', async () => {
    const antes = await montar();
    const user = userEvent.setup();
    await user.click(within(lista()).getByRole('button', { name: /Cliente 104/ }));
    await screen.findByRole('dialog', { name: /^Conversa com/ });
    const rendersDoPopup = await assentarPopup();
    expect(rendersDoPopup).toBeGreaterThan(0);

    act(() => socket.disparar('dashboard:conversation', { conversation: { ...ESPERA[1], lastMessageContent: 'outra conversa falou' } }));

    expect(useQuickReplies.mock.calls.length).toBe(rendersDoPopup);
    expect(within(lista()).getByRole('button', { name: /Cliente 102/ })).toHaveTextContent('outra conversa falou');
    expect(rendersPorContato.get('ct1')).toBe(antes.get('ct1'));
  });

  test('popup aberto, evento de outra conversa E a equipe buscada de novo: o popup fica parado', async () => {
    await montar();
    const user = userEvent.setup();
    await user.click(within(lista()).getByRole('button', { name: /Cliente 104/ }));
    await screen.findByRole('dialog', { name: /^Conversa com/ });
    const rendersDoPopup = await assentarPopup();

    useAgents.mockReturnValue({ agents: AGENTES_BUSCADOS_DE_NOVO(), status: 'ready' });
    act(() => socket.disparar('dashboard:conversation', { conversation: { ...ESPERA[1], lastMessageContent: 'outra conversa falou' } }));

    expect(useQuickReplies.mock.calls.length).toBe(rendersDoPopup);
  });

  test('evento da própria conversa aberta chega ao popup', async () => {
    await montar();
    const user = userEvent.setup();
    await user.click(within(lista()).getByRole('button', { name: /Cliente 104/ }));
    const dialogo = await screen.findByRole('dialog', { name: /^Conversa com/ });
    const rendersDoPopup = await assentarPopup();

    act(() => socket.disparar('dashboard:conversation', { conversation: { ...ATENDIMENTO[0], contactDisplayName: 'Cliente 104 Renomeado' } }));

    expect(useQuickReplies.mock.calls.length).toBeGreaterThan(rendersDoPopup);
    expect(within(dialogo).getAllByText('Cliente 104 Renomeado').length).toBeGreaterThan(0);
  });
});
