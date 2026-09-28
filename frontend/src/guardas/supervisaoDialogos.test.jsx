import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
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
import { useReasons } from '../hooks/useReasons';

// Transferir e Encerrar na Supervisão (27/09): os mesmos diálogos da mesa,
// abertos por cima do popup. O Encerrar vem pelo menu "Mais opções" e chega
// sob demanda, com os motivos; o Escape fecha só o diálogo de cima, e fechar
// devolve o foco a quem abriu.

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/CloseReasonModal', async (original) => {
  avaliados.add('CloseReasonModal');
  return original();
});
vi.mock('../components/icones/motivos', async (original) => {
  avaliados.add('motivos');
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
vi.mock('../hooks/useReasons');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'agent-9', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Atendente A', online: true, activeConversations: 2 }], status: 'ready', refresh: vi.fn() });
  useSectors.mockReturnValue({ sectors: [], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  getPublicCompany.mockResolvedValue({ name: '' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useReasons.mockReturnValue({ reasons: [{ id: 'r1', name: 'Sem conexão', active: true }, { id: 'r2', name: 'Mudança de plano', active: true }], status: 'ready', loading: false, refresh: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactId: 'ct1', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'x', createdAt: new Date().toISOString() }],
    waiting: [], inAutomation: [], closedTodayCount: 0, status: 'ready', loading: false, refresh: vi.fn(), aplicarContatoSalvo: vi.fn(),
  });
});

async function abrirPopup(user) {
  renderInShell(<SupervisionPage />, { path: '/supervisao' });
  await user.click(within(screen.getByRole('region', { name: /^Conversas/ })).getByRole('button', { name: /Cliente 101/ }));
  return screen.findByRole('dialog', { name: /^Conversa com/ });
}

describe('Supervisão: Transferir e Encerrar por cima do popup', () => {
  test('Encerrar pelo menu chega sob demanda com os motivos; Escape fecha só ele', async () => {
    const user = userEvent.setup();
    const popup = await abrirPopup(user);
    expect(avaliados.has('CloseReasonModal')).toBe(false);
    expect(avaliados.has('motivos')).toBe(false);

    await user.click(within(popup).getByRole('button', { name: 'Mais opções' }));
    await user.click(screen.getByRole('menuitem', { name: 'Encerrar atendimento' }));
    const encerrar = await screen.findByRole('dialog', { name: 'Encerrar atendimento' });
    expect(avaliados.has('CloseReasonModal')).toBe(true);
    expect(avaliados.has('motivos')).toBe(true);
    expect(within(encerrar).getAllByRole('radio').map((r) => r.labels[0].querySelector('.en-nome').textContent)).toEqual(['Sem conexão', 'Mudança de plano']);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Encerrar atendimento' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /^Conversa com/ })).toBeInTheDocument();
  });

  test('Transferir abre por cima do popup e o "Fechar" devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    const popup = await abrirPopup(user);
    const botao = within(popup).getByRole('button', { name: 'Transferir atendimento' });
    await user.click(botao);
    const transferir = await screen.findByRole('dialog', { name: 'Transferir atendimento' });
    expect(within(transferir).getByRole('radio', { name: /Atendente A/ })).toHaveTextContent('2 atendimentos');
    await user.click(within(transferir).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transferir atendimento' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /^Conversa com/ })).toBeInTheDocument();
    expect(botao).toHaveFocus();
  });
});
