import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationInfoPanel from './ConversationInfoPanel';
import { useAuth } from '../contexts/AuthContext';
import { useSectors } from '../hooks/useSectors';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useSectors');
vi.mock('../services/api');

const SECTORS = [
  { id: 's-1', name: 'Financeiro' },
  { id: 's-2', name: 'Suporte' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useSectors.mockReturnValue({ sectors: SECTORS, loading: false, refresh: vi.fn() });
  api.setConversationSector = vi.fn().mockResolvedValue({});
});

const CONVERSATION = {
  id: 'conv-1',
  contactId: 'contact-1',
  contactDisplayName: 'Carlos',
  contactPhoneNumber: '+5511999990000',
  status: 'assigned',
  assignedAgentId: 'agent-1',
};

describe('ConversationInfoPanel', () => {
  test('shows the internal note when the contact has one', () => {
    render(<ConversationInfoPanel conversation={{ ...CONVERSATION, contactInternalNote: 'Já reclamou 3x do mesmo problema' }} />);
    expect(screen.getByText('Já reclamou 3x do mesmo problema')).toBeInTheDocument();
  });

  test('shows no note section when the contact has none', () => {
    render(<ConversationInfoPanel conversation={CONVERSATION} />);
    expect(screen.queryByText(/nota interna/i)).not.toBeInTheDocument();
  });

  test('shows the protocol number when the conversation has one', () => {
    render(<ConversationInfoPanel conversation={{ ...CONVERSATION, protocolNumber: '20260911-0001' }} />);
    expect(screen.getByText('Protocolo')).toBeInTheDocument();
    expect(screen.getByText('20260911-0001')).toBeInTheDocument();
  });

  test('does not show a protocol row before one has been claimed', () => {
    render(<ConversationInfoPanel conversation={{ ...CONVERSATION, protocolNumber: null }} />);
    expect(screen.queryByText('Protocolo')).not.toBeInTheDocument();
  });

  describe('Triagem por IA', () => {
    const TRIAGED = {
      ...CONVERSATION,
      aiTriageCompletedAt: '2026-09-12T10:00:00.000Z',
      aiTriageSectorId: 's-2',
      aiTriageReasonName: 'Segunda via',
      aiTriageIdentifiedBy: 'cpf_confirmed',
      aiTriageConfidence: 0.87,
      aiTriageSummary: 'Cliente pediu segunda via do boleto.',
    };

    test('shows the block with every field when the triage has completed', () => {
      render(<ConversationInfoPanel conversation={TRIAGED} />);
      expect(screen.getByText('Triagem por IA')).toBeInTheDocument();
      expect(screen.getByText('Setor da IA')).toBeInTheDocument();
      // 'Suporte' also appears as an <option> in the sector-correction <select>, so scope
      // the assertion to the AI triage InfoRow's value (its label's next sibling).
      expect(screen.getByText('Setor da IA').nextElementSibling).toHaveTextContent('Suporte');
      expect(screen.getByText('Motivo')).toBeInTheDocument();
      expect(screen.getByText('Segunda via')).toBeInTheDocument();
      expect(screen.getByText('Identificação')).toBeInTheDocument();
      expect(screen.getByText('CPF + nascimento')).toBeInTheDocument();
      expect(screen.getByText('Confiança')).toBeInTheDocument();
      expect(screen.getByText('87%')).toBeInTheDocument();
      expect(screen.getByText('Cliente pediu segunda via do boleto.')).toBeInTheDocument();
    });

    test('shows no block when the triage has not completed', () => {
      render(<ConversationInfoPanel conversation={{ ...CONVERSATION, aiTriageCompletedAt: null }} />);
      expect(screen.queryByText('Triagem por IA')).not.toBeInTheDocument();
    });

    test('maps every aiTriageIdentifiedBy value to its Portuguese label', () => {
      const cases = [
        ['memory', 'memória'],
        ['phone', 'telefone'],
        ['cpf', 'CPF'],
        ['cpf_confirmed', 'CPF + nascimento'],
        ['none', 'não identificado'],
      ];
      cases.forEach(([identifiedBy, label]) => {
        const { unmount } = render(<ConversationInfoPanel conversation={{ ...TRIAGED, aiTriageIdentifiedBy: identifiedBy }} />);
        expect(screen.getByText(label)).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe('correção de setor', () => {
    test('shows a sector select for the conversation\'s assigned agent, and changing it calls the API', async () => {
      const user = userEvent.setup();
      render(<ConversationInfoPanel conversation={{ ...CONVERSATION, sectorId: 's-1', sectorName: 'Financeiro' }} />);

      const select = screen.getByLabelText('Alterar setor');
      await user.selectOptions(select, 's-2');

      expect(api.setConversationSector).toHaveBeenCalledWith('conv-1', 's-2', 'tok-123');
    });

    test('shows a sector select for an admin even when the conversation is assigned to someone else', () => {
      useAuth.mockReturnValue({ token: 'tok-admin', agent: { id: 'admin-1', role: 'admin' } });
      render(<ConversationInfoPanel conversation={{ ...CONVERSATION, assignedAgentId: 'other-agent' }} />);
      expect(screen.getByLabelText('Alterar setor')).toBeInTheDocument();
    });

    test('shows a sector select for a manager even when the conversation is assigned to someone else', () => {
      useAuth.mockReturnValue({ token: 'tok-manager', agent: { id: 'manager-1', role: 'manager' } });
      render(<ConversationInfoPanel conversation={{ ...CONVERSATION, assignedAgentId: 'other-agent' }} />);
      expect(screen.getByLabelText('Alterar setor')).toBeInTheDocument();
    });

    test('hides the sector select for an agent who is neither assigned to the conversation nor an admin', () => {
      useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-2', role: 'agent' } });
      render(<ConversationInfoPanel conversation={{ ...CONVERSATION, assignedAgentId: 'agent-1' }} />);
      expect(screen.queryByLabelText('Alterar setor')).not.toBeInTheDocument();
    });
  });
});
