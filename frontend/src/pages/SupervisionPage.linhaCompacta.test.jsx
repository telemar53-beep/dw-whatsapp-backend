import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from './SupervisionPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday, closeConversation, getPublicCompany } from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';

// O QUE a linha compacta informa DENTRO da Supervisão. Lá ela é a célula de
// contato de cada registro: cidade, setor e responsável saem dela (a página
// zera esses campos) porque têm colunas próprias no registro. Fica na linha o
// que identifica o atendimento e o estado da IA, e o "Finalizar sem motivo".
//
// Escrito antes do redesenho da linha compacta; ver a legenda [FICA]/[MUDA]
// em DashboardPage.linhaCompacta.test.jsx. Aqui tudo é [FICA].

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const ULTIMA = '2026-09-24T15:42:00.000Z';

function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const LUGAR = { contactCityName: 'Cândido Mendes', contactLocalityName: 'Barão de Tromaí', sectorName: 'Financeiro' };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Ana Souza', email: 'ana@dw.com' }], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  getPublicCompany.mockResolvedValue({ name: '' });
  closeConversation.mockResolvedValue({ id: 'c2', status: 'closed' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{
      id: 'c1', contactDisplayName: 'Raimunda Nonata', channelId: 'chan-1', status: 'assigned',
      assignedAgentId: 'agent-1', assignedAgentName: 'Ana Souza', sectorId: 'sector-1', ...LUGAR,
      lastMessageContent: 'Minha internet caiu de novo', lastMessageAt: ULTIMA,
      aiTriageCompletedAt: ULTIMA, aiTriageReasonName: 'Sem conexão', aiTriageLowConfidence: true,
    }],
    waiting: [{
      id: 'c2', contactDisplayName: 'Joaquim Pereira', channelId: 'chan-1', status: 'waiting',
      assignedAgentId: null, sectorId: 'sector-1', ...LUGAR,
      lastMessageContent: 'Quero a segunda via', lastMessageAt: ULTIMA,
      aiTriageCompletedAt: ULTIMA, aiTriageReasonName: 'Segunda via', aiTriageResolvedByAi: true,
    }],
    inAutomation: [{
      id: 'c3', contactDisplayName: 'Francisca Lima', channelId: 'chan-1', status: 'waiting',
      assignedAgentId: null, sectorId: null, triageState: 'pending', ...LUGAR,
      lastMessageContent: 'Oi', lastMessageAt: ULTIMA,
    }],
    closedTodayCount: 0,
    status: 'ready',
    loading: false,
    refresh: vi.fn(),
  });
});

// Na Supervisão existem DOIS botões por atendimento: a linha (nome acessível
// começa pelo nome do contato) e o "Abrir conversa de …" do registro.
function linhaDe(nome) {
  return screen.getByRole('button', { name: new RegExp(`^${nome}`) });
}
function itemDe(linha) {
  return screen.getAllByRole('listitem').filter((li) => li.contains(linha)).pop();
}

describe('linha compacta — Supervisão', () => {
  test('[FICA] nome, hora e prévia na linha', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const linha = await screen.findByRole('button', { name: /^Raimunda Nonata/ });

    expect(within(linha).getByText('Raimunda Nonata')).toBeInTheDocument();
    expect(within(linha).getByText(hora(ULTIMA))).toBeInTheDocument();
    expect(within(linha).getByText('Minha internet caiu de novo')).toBeInTheDocument();
  });

  test('[FICA] estado da IA: "IA · motivo", ⚠ com nome acessível, "Resolvido pela IA", "IA em triagem"', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const andamento = await screen.findByRole('button', { name: /^Raimunda Nonata/ });

    expect(within(andamento).getByText('IA · Sem conexão')).toBeInTheDocument();
    expect(within(andamento).getByLabelText('Triagem com confiança baixa')).toHaveTextContent('⚠');
    expect(andamento).toHaveAccessibleName(/Triagem com confiança baixa/);

    const espera = linhaDe('Joaquim Pereira');
    expect(within(espera).getByText('IA · Segunda via')).toBeInTheDocument();
    expect(within(espera).getByText('Resolvido pela IA')).toBeInTheDocument();

    expect(within(linhaDe('Francisca Lima')).getByText('IA em triagem')).toBeInTheDocument();
  });

  // O lugar e o setor aparecem UMA vez por registro, na coluna própria — a
  // página zera esses campos antes de passar a conversa para a linha.
  test('[FICA] lugar e setor ficam na coluna do registro, não duplicados na linha', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const linha = await screen.findByRole('button', { name: /^Raimunda Nonata/ });
    const registro = screen.getAllByRole('listitem').find((li) => li.contains(linha));

    expect(within(registro).getAllByText('Barão de Tromaí · Cândido Mendes')).toHaveLength(1);
    expect(linha).not.toHaveAccessibleName(/Cândido Mendes/);
    expect(linha).not.toHaveAccessibleName(/Financeiro/);
    expect(linha).not.toHaveAccessibleName(/Ana Souza/);
  });

  test('[FICA] "Finalizar sem motivo" é irmão da linha em Espera e Automação, e não existe em Andamento', async () => {
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    const andamento = await screen.findByRole('button', { name: /^Raimunda Nonata/ });

    expect(within(itemDe(andamento)).queryByRole('button', { name: 'Finalizar sem motivo' })).not.toBeInTheDocument();
    for (const nome of ['Joaquim Pereira', 'Francisca Lima']) {
      const linha = linhaDe(nome);
      const finalizar = within(itemDe(linha)).getByRole('button', { name: 'Finalizar sem motivo' });
      expect(linha).not.toContainElement(finalizar);
      expect(linha).not.toHaveAccessibleName(/Finalizar/);
    }
  });
});
