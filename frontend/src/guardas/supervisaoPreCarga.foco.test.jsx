import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from '../pages/SupervisionPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday, getPublicCompany } from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';

// Variante pelo teclado de supervisaoPreCarga.test.jsx (arquivo à parte: o
// registro de módulos avaliados vale por arquivo).
//
// Pré-carga por intenção (medição de 27/09): com a conversa sob demanda, a
// PRIMEIRA abertura do popup pagava o download — com CPU 4×, 349 → 678 ms na
// carga normal. O ponteiro ou o foco entrando na lista já pede o trecho; o
// clique chega com ele a caminho. Continua sob demanda: abrir a página sem
// chegar perto da lista não baixa nada (supervisaoSobDemanda.test.jsx).

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/ConversationModal', async (original) => {
  avaliados.add('ConversationModal');
  return original();
});
vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'agent-9', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  getPublicCompany.mockResolvedValue({ name: '' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactId: 'ct1', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: null, channelId: 'x', createdAt: new Date().toISOString() }],
    waiting: [], inAutomation: [], closedTodayCount: 0, status: 'ready', loading: false, refresh: vi.fn(), aplicarContatoSalvo: vi.fn(),
  });
});

describe('Supervisão: pré-carga da conversa por intenção', () => {
  test('o foco chegando a uma linha já pede a conversa, sem abrir nada', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    expect(avaliados.has('ConversationModal')).toBe(false);
    fireEvent.focus(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Cliente 101/ }));
    await waitFor(() => expect(avaliados.has('ConversationModal')).toBe(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
