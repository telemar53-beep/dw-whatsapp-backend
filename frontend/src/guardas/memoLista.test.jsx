import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from '../pages/DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

// Guarda da memoização da lista de atendimentos.
//
// Medido no programa de desempenho: com 40 conversas, cada evento de socket
// re-renderizava os 40 itens, inclusive quando nada tinha mudado para eles.
// Hoje: nada muda → 0 re-renders; uma conversa muda → 1.
//
// Isso depende de TRÊS peças ao mesmo tempo, e basta perder uma para voltar
// aos 40: o memo do ConversationListItem e o useCallback de `onSelect` e de
// `onQuickClose` no DashboardPage. Nenhuma delas muda o que aparece na tela,
// então nenhum outro teste percebe. (O useMemo das listas filtradas NÃO entra
// na conta: QueueList e MyConversationsList não são memo, e o item compara
// conversa por conversa — tirá-lo não muda estes números.)
//
// O CONTADOR é o ContactAvatar: todo render do item chama o avatar uma vez (o
// stub abaixo não é memo, então não esconde nada). Se o redesenho tirar o
// avatar da linha, troque o contador por outro filho que a linha sempre monte.

const controle = vi.hoisted(() => ({
  minhasIniciais: [],
  filaInicial: [],
  definirMinhas: null,
  definirFila: null,
  renders: new Map(),
}));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready' }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');

// As duas listas viram estado de verdade, como no hook real: um evento de
// socket troca o array, e quem não mudou mantém a referência.
vi.mock('../hooks/useMyConversations', async () => {
  const { useState } = await import('react');
  return {
    useMyConversations: () => {
      const [conversations, definir] = useState(controle.minhasIniciais);
      controle.definirMinhas = definir;
      return { conversations, status: 'ready' };
    },
  };
});
vi.mock('../hooks/useQueue', async () => {
  const { useState } = await import('react');
  return {
    useQueue: () => {
      const [queue, definir] = useState(controle.filaInicial);
      controle.definirFila = definir;
      return { queue, status: 'ready' };
    },
  };
});

vi.mock('../components/ContactAvatar', () => ({
  default: ({ contactId }) => {
    controle.renders.set(contactId, (controle.renders.get(contactId) || 0) + 1);
    return null;
  },
}));

function conversas(prefixo, quantidade) {
  return Array.from({ length: quantidade }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `${prefixo}-${n}`,
      contactId: `${prefixo}-contato-${n}`,
      contactDisplayName: `Cliente ${prefixo} ${n}`,
      contactPhoneNumber: `+55989990000${n}`,
      contactCityName: 'Cândido Mendes',
      sectorName: 'Suporte',
      lastMessageContent: `mensagem ${n}`,
      lastMessageAt: '2026-09-24T12:00:00.000Z',
      createdAt: '2026-09-24T11:00:00.000Z',
      status: prefixo === 'minha' ? 'assigned' : 'waiting',
      assignedAgentId: prefixo === 'minha' ? 'agent-1' : null,
    };
  });
}

function totalDeRenders() {
  return [...controle.renders.values()].reduce((soma, n) => soma + n, 0);
}

const LARGURA_PADRAO = window.innerWidth;
function larguraDaJanela(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Janela larga: lista expandida (a variante compact), não o rail.
  larguraDaJanela(1600);
  controle.minhasIniciais = conversas('minha', 40);
  controle.filaInicial = conversas('fila', 40);
  controle.renders.clear();
  // mockReturnValue devolve o MESMO objeto a cada render: token, clearUnread e
  // o Set de não lidas ficam estáveis, como nos hooks reais.
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Net Fibra', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
});
afterEach(() => larguraDaJanela(LARGURA_PADRAO));

describe('lista de atendimentos: só re-renderiza o item que mudou', () => {
  test('aba Atendimento, 40 conversas: nada muda → 0; uma muda → 1', () => {
    renderInShell(<DashboardPage />);
    expect(screen.getByText('Cliente minha 40')).toBeInTheDocument();
    expect(controle.renders.size).toBe(40);

    // Evento que troca o array sem mudar item nenhum (o caso de todo evento
    // que diz respeito a OUTRA conversa).
    controle.renders.clear();
    act(() => controle.definirMinhas((anteriores) => [...anteriores]));
    expect(totalDeRenders()).toBe(0);

    // Uma conversa recebe mensagem nova.
    act(() =>
      controle.definirMinhas((anteriores) =>
        anteriores.map((c) => (c.id === 'minha-07' ? { ...c, lastMessageContent: 'chegou agora' } : c))
      )
    );
    expect(screen.getByText('chegou agora')).toBeInTheDocument();
    expect(Object.fromEntries(controle.renders)).toEqual({ 'minha-contato-07': 1 });
  });

  // Espera usa também `onQuickClose`: o useCallback dele só é provado aqui.
  test('aba Espera, 40 conversas: nada muda → 0; uma muda → 1', async () => {
    renderInShell(<DashboardPage />);
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.getByText('Cliente fila 40')).toBeInTheDocument();

    controle.renders.clear();
    act(() => controle.definirFila((anteriores) => [...anteriores]));
    expect(totalDeRenders()).toBe(0);

    act(() =>
      controle.definirFila((anteriores) =>
        anteriores.map((c) => (c.id === 'fila-13' ? { ...c, lastMessageContent: 'alguém aí?' } : c))
      )
    );
    expect(screen.getByText('alguém aí?')).toBeInTheDocument();
    expect(Object.fromEntries(controle.renders)).toEqual({ 'fila-contato-13': 1 });
  });

  // Estado do próprio DashboardPage (a busca) também não pode arrastar a lista.
  test('digitar na busca, com todos continuando visíveis, não re-renderiza itens', async () => {
    renderInShell(<DashboardPage />);
    controle.renders.clear();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar conversa' }), 'cli');

    expect(screen.getByText('Cliente minha 40')).toBeInTheDocument();
    expect(totalDeRenders()).toBe(0);
  });
});
