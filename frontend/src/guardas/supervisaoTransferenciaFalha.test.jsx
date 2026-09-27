import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Variante de supervisaoPopupFalha.test.jsx para a transferência, que também
// chega sob demanda: o trecho dela não baixou, o popup continua aberto e a
// página avisa.
vi.mock('../components/TransferModal', () => {
  throw new Error('falha simulada ao baixar o trecho');
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

describe('Supervisão: a transferência não baixou', () => {
  test('o popup continua aberto e a página avisa', async () => {
    const user = userEvent.setup();
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Cliente 101/ }));
    await screen.findByRole('dialog', { name: 'Conversa' });
    await user.click(screen.getByRole('button', { name: /transferir atendimento/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir a transferência. Verifique a conexão e tente de novo.');
    expect(screen.getByRole('dialog', { name: 'Conversa' })).toBeInTheDocument();
  });
});
