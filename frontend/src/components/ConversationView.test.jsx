import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useCities } from '../hooks/useCities';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
  useConversationMessages.mockReturnValue({
    messages: [{ id: 'm1', direction: 'inbound', content: 'Oi, preciso de ajuda' }],
    sendMessage: vi.fn(),
  });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useCities.mockReturnValue({ cities: [], refresh: vi.fn() });
});

describe('ConversationView', () => {
  test('renders the message history', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Oi, preciso de ajuda')).toBeInTheDocument();
  });

  test('renders an image attachment alongside a caption', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        { id: 'm1', direction: 'inbound', messageType: 'image', mediaPath: 'foo.jpg', content: 'Comprovante', mediaFilename: null },
      ],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Comprovante')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('renders a location message without a text bubble', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm2', direction: 'inbound', messageType: 'location', locationLatitude: -3.1, locationLongitude: -60.0, content: null }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByRole('link', { name: /ver localiza/i })).toBeInTheDocument();
  });

  test('shows the Assumir button when the conversation is unassigned', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
  });

  test('clicking Assumir calls claimConversation', async () => {
    api.claimConversation.mockResolvedValue({});
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /assumir/i }));
    await waitFor(() => expect(api.claimConversation).toHaveBeenCalledWith('c1', 'tok-123'));
  });

  test('shows Transferir and Fechar when assigned to me', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fechar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assumir/i })).not.toBeInTheDocument();
  });

  test('clicking Fechar calls closeConversation', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'tok-123'));
  });

  test('clicking Transferir calls onTransferClick with the conversation id', async () => {
    const onTransferClick = vi.fn();
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={onTransferClick}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /transferir/i }));
    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });

  test('shows neither action button when assigned to another agent', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /assumir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fechar/i })).not.toBeInTheDocument();
  });

  test('does not render the message input when the conversation is assigned to another agent or unassigned', () => {
    const { rerender } = render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();

    rerender(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByPlaceholderText(/digite uma mensagem/i)).not.toBeInTheDocument();
  });

  test('renders the message input when the conversation is assigned to me', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toBeInTheDocument();
  });

  test('sending a message with an attached file calls sendMessage with both content and the file', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    useConversationMessages.mockReturnValue({ messages: [], sendMessage });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    const fakeFile = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]');

    await userEvent.upload(fileInput, fakeFile);
    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'Segue a foto');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Segue a foto', fakeFile));
  });

  test('opens the previous-conversations history modal for the conversation contact', async () => {
    api.getConversationHistory.mockResolvedValue([
      { id: 'conv-old', channelName: 'Berg', channelType: 'baileys', updatedAt: '2026-08-01T12:00:00.000Z' },
    ]);
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /ver atendimentos anteriores/i }));

    await waitFor(() => expect(api.getConversationHistory).toHaveBeenCalledWith('contact-1', 'tok-123'));
    expect(await screen.findByText('Atendimentos anteriores')).toBeInTheDocument();
  });

  test('shows a back button that calls onBack when clicked', async () => {
    const onBack = vi.fn();
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
        onBack={onBack}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));
    expect(onBack).toHaveBeenCalled();
  });

  test('shows the contact name and avatar in the header', () => {
    render(
      <ConversationView
        conversation={{
          id: 'c1',
          contactId: 'contact-1',
          status: 'waiting',
          assignedAgentId: null,
          contactDisplayName: 'Carlos',
          contactPhoneNumber: '+5511999990000',
          contactAvatarPath: 'avatars/c1.jpg',
        }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  test('falls back to "Conversa" in the header when the contact has no name or phone number yet', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Conversa')).toBeInTheDocument();
  });

  test('the edit-contact trigger\'s accessible name includes the contact name, not just "Editar cliente"', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Maria' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /editar cliente: maria/i })).toBeInTheDocument();
  });

  test('does not render the contact name as a heading (invalid inside a button)', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Maria' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('clicking the contact name/avatar opens the edit-contact modal', async () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /editar cliente/i }));

    expect(screen.getByText('Editar cliente')).toBeInTheDocument();
  });

  test('saving in the edit-contact modal updates the header immediately', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: null });
    render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /editar cliente/i }));
    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(screen.getByText('Carlos Editado')).toBeInTheDocument());
  });

  test('does not carry a contact-name override over to a different conversation', async () => {
    api.updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Carlos Editado', cityId: null });
    const { rerender } = render(
      <ConversationView
        conversation={{ id: 'c1', contactId: 'contact-1', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /editar cliente/i }));
    await userEvent.clear(screen.getByLabelText(/nome/i));
    await userEvent.type(screen.getByLabelText(/nome/i), 'Carlos Editado');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(screen.getByText('Carlos Editado')).toBeInTheDocument());

    rerender(
      <ConversationView
        conversation={{ id: 'c2', contactId: 'contact-2', status: 'waiting', assignedAgentId: null, contactDisplayName: 'Maria' }}
        onTransferClick={vi.fn()}
      />
    );

    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByText('Carlos Editado')).not.toBeInTheDocument();
  });
});
