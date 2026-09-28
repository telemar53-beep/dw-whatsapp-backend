import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from '../pages/DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

// Variante de supervisaoTransferenciaFalha.test.jsx para a mesa: o trecho do
// Transferir ou do Encerrar não baixou. A conversa continua aberta, a rota não
// cai, e a mesa avisa — e o botão volta a funcionar numa segunda tentativa.
vi.mock('../components/TransferModal', () => {
  throw new Error('falha simulada ao baixar o trecho');
});
vi.mock('../components/CloseReasonModal', () => {
  throw new Error('falha simulada ao baixar o trecho');
});
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  listCities: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready', refresh: () => {} }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useQueue.mockReturnValue({ queue: [], status: 'ready' });
  useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: 'agent-1' }], status: 'ready' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Provedor Exemplo', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
});

async function abrirConversa(user) {
  renderInShell(<DashboardPage />);
  await user.click(screen.getByText('Cliente 101'));
  return screen.findByRole('button', { name: 'Transferir atendimento' });
}

describe('mesa: o trecho do diálogo não baixou', () => {
  test('Transferir: a mesa avisa e a conversa continua aberta', async () => {
    const user = userEvent.setup();
    await abrirConversa(user);
    await user.click(screen.getByRole('button', { name: 'Transferir atendimento' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Não foi possível abrir a transferência. Verifique a conexão e tente de novo.');
    expect(screen.queryByRole('dialog', { name: 'Transferir atendimento' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.getByRole('button', { name: 'Transferir atendimento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toBeInTheDocument();
  });

  test('Encerrar: a conversa avisa e continua aberta', async () => {
    const user = userEvent.setup();
    await abrirConversa(user);
    await user.click(screen.getByRole('button', { name: 'Encerrar atendimento' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Não foi possível abrir o encerramento. Verifique a conexão e tente de novo.');
    expect(screen.queryByRole('dialog', { name: 'Encerrar atendimento' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.getByRole('button', { name: 'Encerrar atendimento' })).toBeInTheDocument();
  });
});
