import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConversationInfoPanel from './ConversationInfoPanel';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok-123' });
});

const CONVERSATION = {
  id: 'conv-1',
  contactId: 'contact-1',
  contactDisplayName: 'Carlos',
  contactPhoneNumber: '+5511999990000',
  status: 'assigned',
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
});
