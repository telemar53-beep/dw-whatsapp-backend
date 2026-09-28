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
import { getDashboardClosedToday } from '../services/api';

// O popup chega sob demanda. Se o trecho não baixar (rede caiu, ou um deploy
// trocou os arquivos), a página avisa e continua de pé — antes, com o lazy e
// sem limite de erro, a falha subia até a rota e trocava a página inteira.
vi.mock('../components/supervisao/PopupDaSupervisao', () => {
  throw new Error('falha simulada ao baixar o trecho');
});
vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'agent-9', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactId: 'ct1', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: null, channelId: 'x', createdAt: new Date().toISOString() }],
    waiting: [], inAutomation: [], closedTodayCount: 0, status: 'ready', loading: false, refresh: vi.fn(), aplicarContatoSalvo: vi.fn(),
  });
});

describe('Supervisão: a conversa não baixou', () => {
  test('a página avisa e continua de pé, com a lista na tela', async () => {
    const user = userEvent.setup();
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Cliente 101/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir a conversa. Verifique a conexão e tente de novo.');
    expect(screen.getByRole('heading', { level: 1, name: 'Supervisão' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Cliente 101/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
