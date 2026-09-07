import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationListItem from './ConversationListItem';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('ConversationListItem', () => {
  test('shows the contact name and phone number', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByText('+5511999990000')).toBeInTheDocument();
  });

  test('shows a sector tag when the conversation has one', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000', sectorName: 'Financeiro' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
  });

  test('shows no tag when the conversation has no sector', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000', sectorName: null }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();
  });

  test('calls onSelect with the conversation id when clicked', async () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={onSelect}
        />
      </ul>
    );
    await userEvent.click(screen.getByText('Carlos'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });

  test('shows the contact avatar photo when contactAvatarPath is set', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactId: 'contact-1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactAvatarPath: 'avatars/c1.jpg',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('shows a placeholder initial when there is no contactAvatarPath', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactId: 'contact-1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactAvatarPath: null,
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('shows the city suffix after the name when the contact has one', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactCityName: 'Bahia',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Carlos - Bahia')).toBeInTheDocument();
  });

  test('shows just the name when the contact has no city', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            contactCityName: null,
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByText(/Carlos -/)).not.toBeInTheDocument();
  });

  test('falls back to "Conversa" when there is neither a display name nor a phone number', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: null,
            contactPhoneNumber: null,
            contactCityName: 'Bahia',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Conversa - Bahia')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
