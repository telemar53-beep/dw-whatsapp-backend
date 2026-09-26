import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from '../components/ConversationView';
import { VARIANTE_DA_MESA } from '../components/ConversaDaMesa';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { usePlaces } from '../hooks/useCities';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

// Guarda de "Atendimentos anteriores" sob demanda: a mesma de
// dadosClienteSobDemanda.test.jsx, na ordem inversa (Histórico primeiro).

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/EditContactModal', async (original) => {
  avaliados.add('editar');
  return original();
});
vi.mock('../components/ConversationHistoryModal', async (original) => {
  avaliados.add('historico');
  return original();
});
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
vi.mock('../services/api');

const MINHA = { id: 'c1', contactId: 'contato-1', contactDisplayName: 'Cliente Exemplo', status: 'assigned', assignedAgentId: 'agent-1' };
const mesa = () => render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} onBack={vi.fn()} workspace variante={VARIANTE_DA_MESA} />);

beforeEach(() => {
  avaliados.clear();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  usePlaces.mockReturnValue({ places: [], status: 'ready', refresh: vi.fn() });
  useReasons.mockReturnValue({ reasons: [], loading: false, refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.getConversationHistory.mockResolvedValue([]);
});

describe('Atendimentos anteriores sob demanda', () => {
  // Arquivo próprio porque o módulo é avaliado uma vez só por arquivo: aqui o
  // Histórico abre primeiro, e o modal de edição não pode vir junto.
  test('abrir "Histórico" traz só o modal de atendimentos anteriores', async () => {
    mesa();
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByRole('dialog', { name: 'Atendimentos anteriores' })).toBeInTheDocument();
    expect(avaliados.has('historico')).toBe(true);
    expect(avaliados.has('editar')).toBe(false);
  });
});
