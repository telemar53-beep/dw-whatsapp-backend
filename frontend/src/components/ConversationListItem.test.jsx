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

  test('shows the assigned agent name as a tag when the conversation has one', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000', assignedAgentName: 'Ana' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  test('shows no agent tag when the conversation has no assignedAgentName', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
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

  test('shows the last message content as a preview', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            lastMessageContent: 'Oi, tudo bem?',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Oi, tudo bem?')).toBeInTheDocument();
    expect(screen.queryByText('+5511999990000')).not.toBeInTheDocument();
  });

  test('shows a media type label as the preview when the last message has no caption', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'A', lastMessageType: 'image', lastMessageContent: null }}
          onSelect={vi.fn()}
        />
        <ConversationListItem
          conversation={{ id: 'c2', contactDisplayName: 'B', lastMessageType: 'audio', lastMessageContent: null }}
          onSelect={vi.fn()}
        />
        <ConversationListItem
          conversation={{ id: 'c3', contactDisplayName: 'C', lastMessageType: 'video', lastMessageContent: null }}
          onSelect={vi.fn()}
        />
        <ConversationListItem
          conversation={{ id: 'c4', contactDisplayName: 'D', lastMessageType: 'document', lastMessageContent: null }}
          onSelect={vi.fn()}
        />
        <ConversationListItem
          conversation={{ id: 'c5', contactDisplayName: 'E', lastMessageType: 'sticker', lastMessageContent: null }}
          onSelect={vi.fn()}
        />
        <ConversationListItem
          conversation={{ id: 'c6', contactDisplayName: 'F', lastMessageType: 'location', lastMessageContent: null }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('📷 Foto')).toBeInTheDocument();
    expect(screen.getByText('🎤 Áudio')).toBeInTheDocument();
    expect(screen.getByText('🎥 Vídeo')).toBeInTheDocument();
    expect(screen.getByText('📄 Documento')).toBeInTheDocument();
    expect(screen.getByText('😀 Figurinha')).toBeInTheDocument();
    expect(screen.getByText('📍 Localização')).toBeInTheDocument();
  });

  test('falls back to the phone number as the preview when there is no last message yet', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('+5511999990000')).toBeInTheDocument();
  });

  test('shows the last message time next to the name', () => {
    const lastMessageAt = '2026-09-07T14:27:00.000Z';
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            lastMessageContent: 'Oi',
            lastMessageAt,
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    const expectedTime = new Date(lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
  });

  test('shows no time when the conversation has no last message', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000', lastMessageAt: null }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).not.toBeInTheDocument();
  });

  test('shows the delivery status ticks next to the preview for the agent\'s own outbound message', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            lastMessageContent: 'Como posso ajudar?',
            lastMessageDirection: 'outbound',
            lastMessageStatus: 'delivered',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByTitle('Entregue')).toBeInTheDocument();
  });

  test('shows an unread indicator when unread is true', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
          unread
        />
      </ul>
    );
    expect(screen.getByTitle('Mensagem não lida')).toBeInTheDocument();
  });

  test('shows no unread indicator by default', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByTitle('Mensagem não lida')).not.toBeInTheDocument();
  });

  test('shows no status ticks for an inbound last message from the contact', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{
            id: 'c1',
            contactDisplayName: 'Carlos',
            contactPhoneNumber: '+5511999990000',
            lastMessageContent: 'Oi, tudo bem?',
            lastMessageDirection: 'inbound',
            lastMessageStatus: 'received',
          }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByTitle('Enviado')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Entregue')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Lido')).not.toBeInTheDocument();
  });

  test('shows no quick-close button when onQuickClose is not given', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
        />
      </ul>
    );
    expect(screen.queryByRole('button', { name: /finalizar/i })).not.toBeInTheDocument();
  });

  test('shows a quick-close button when onQuickClose is given', () => {
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
          onQuickClose={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByRole('button', { name: /finalizar/i })).toBeInTheDocument();
  });

  test('clicking the quick-close button asks for confirmation and calls onQuickClose without opening the conversation', async () => {
    const onQuickClose = vi.fn();
    const onSelect = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={onSelect}
          onQuickClose={onQuickClose}
        />
      </ul>
    );

    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));

    expect(window.confirm).toHaveBeenCalledWith('Encerrar esse atendimento sem motivo?');
    expect(onQuickClose).toHaveBeenCalledWith('c1');
    expect(onSelect).not.toHaveBeenCalled();
    window.confirm.mockRestore();
  });

  test('clicking the quick-close button does not call onQuickClose when the confirmation is declined', async () => {
    const onQuickClose = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={vi.fn()}
          onQuickClose={onQuickClose}
        />
      </ul>
    );

    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));

    expect(onQuickClose).not.toHaveBeenCalled();
    window.confirm.mockRestore();
  });

  test('clicking the row still calls onSelect as before', async () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <ConversationListItem
          conversation={{ id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '+5511999990000' }}
          onSelect={onSelect}
          onQuickClose={vi.fn()}
        />
      </ul>
    );
    await userEvent.click(screen.getByText('Carlos'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});
