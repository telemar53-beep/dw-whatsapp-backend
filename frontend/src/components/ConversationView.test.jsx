import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useCities } from '../hooks/useCities';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { useReasons } from '../hooks/useReasons';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSgpLookup');
vi.mock('../hooks/useReasons');
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
  useSgpLookup.mockReturnValue({
    client: null,
    contracts: [],
    loading: false,
    error: null,
    search: vi.fn(),
    fetchDuplicate: vi.fn(),
    duplicateState: {},
  });
  useReasons.mockReturnValue({
    reasons: [{ id: 'r1', name: 'Troca de senha', active: true }],
    loading: false,
    refresh: vi.fn(),
  });
});

describe('ConversationView', () => {
  test('renders the message history', () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Oi, preciso de ajuda')).toBeInTheDocument();
  });

  test('shows delivery status ticks on an outbound message bubble', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'outbound', content: 'Como posso ajudar?', status: 'delivered' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByTitle('Entregue')).toBeInTheDocument();
  });

  test('shows no delivery status ticks on an inbound message bubble', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Oi, tudo bem?', status: 'received' }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(screen.queryByTitle('Enviado')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Entregue')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Lido')).not.toBeInTheDocument();
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

  test('clicking Fechar opens the reason popup, and confirming calls closeConversation', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));

    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'r1', 'tok-123'));
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

  test('shows Transferir and Fechar for a waiting conversation too, without needing to claim it first', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fechar/i })).toBeInTheDocument();
  });

  test('clicking Transferir on a waiting conversation calls onTransferClick', async () => {
    const onTransferClick = vi.fn();
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={onTransferClick}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /transferir/i }));
    expect(onTransferClick).toHaveBeenCalledWith('c1');
  });

  test('clicking Fechar on a waiting conversation opens the popup too', async () => {
    api.closeConversation.mockResolvedValue({});
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    await waitFor(() => expect(api.closeConversation).toHaveBeenCalledWith('c1', 'r1', 'tok-123'));
  });

  test('shows the backend error inline in the popup when closing fails, without using window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    api.closeConversation.mockRejectedValue({ body: { error: 'Conversation is not currently assigned to you, or is closed' } });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(screen.getByRole('button', { name: /confirmar encerramento/i }));

    expect(await screen.findByText('Conversation is not currently assigned to you, or is closed')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('shows an alert with the backend error when claiming fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    api.claimConversation.mockRejectedValue({ body: { error: 'Conversation is already assigned' } });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /assumir/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Conversation is already assigned'));
    alertSpy.mockRestore();
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

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Segue a foto', fakeFile, null, false));
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

  test('shows a reply button on a message with content when the conversation is mine', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Qual o valor da fatura?' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /responder/i })).toBeInTheDocument();
  });

  test('shows no reply button on a message with no text content, even when the conversation is mine', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', messageType: 'image', content: null }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('shows no reply button when the conversation is not mine', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Qual o valor da fatura?' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('clicking the reply button on a message stages it, and sending clears it', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Qual o valor da fatura?' }],
      sendMessage,
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /responder/i }));
    expect(screen.getAllByText('Qual o valor da fatura?').length).toBeGreaterThan(1);

    await userEvent.type(screen.getByPlaceholderText(/digite uma mensagem/i), 'R$150,00');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('R$150,00', null, 'm1', false));
    await waitFor(() => expect(screen.queryByRole('button', { name: /cancelar resposta/i })).not.toBeInTheDocument());
  });

  test('shows a quoted preview on a message that has repliedToPreview', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        {
          id: 'm2',
          direction: 'outbound',
          content: 'R$150,00',
          repliedToPreview: { content: 'Qual o valor da fatura?', direction: 'inbound' },
        },
      ],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Qual o valor da fatura?')).toBeInTheDocument();
    // 'Carlos' legitimately appears twice — once in the header, once as the quote's label —
    // so this must NOT use the singular getByText (it throws on more than one match).
    expect(screen.getAllByText('Carlos').length).toBeGreaterThan(1);
  });

  test('labels a quoted reply to your own earlier message as "Você"', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        {
          id: 'm2',
          direction: 'outbound',
          content: 'Confirmado',
          repliedToPreview: { content: 'Já registramos o pagamento', direction: 'outbound' },
        },
      ],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Carlos' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.getByText('Já registramos o pagamento')).toBeInTheDocument();
  });
});

describe('SGP lookup panel', () => {
  test('the panel is hidden until the "Consultar SGP" button is clicked', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
        onBack={vi.fn()}
      />
    );
    // The header button's accessible name is "Consultar SGP" via aria-label, but the button
    // has no visible text content, so this only matches the panel's own <h2> once it renders.
    expect(screen.queryByText('Consultar SGP')).not.toBeInTheDocument();
  });

  test('clicking "Consultar SGP" shows the panel, clicking again hides it', async () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
        onBack={vi.fn()}
      />
    );

    await userEvent.click(screen.getByLabelText('Consultar SGP'));
    expect(screen.getByText('Consultar SGP')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Consultar SGP'));
    expect(screen.queryByText('Consultar SGP')).not.toBeInTheDocument();
  });

  test('the panel closes when the conversation changes', async () => {
    const CONVERSATION_A = { id: 'c1', status: 'waiting', assignedAgentId: null };
    const CONVERSATION_B = { id: 'c2', status: 'waiting', assignedAgentId: null };
    const { rerender } = render(<ConversationView conversation={CONVERSATION_A} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Consultar SGP'));
    expect(screen.getByText('Consultar SGP')).toBeInTheDocument();

    rerender(<ConversationView conversation={CONVERSATION_B} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText('Consultar SGP')).not.toBeInTheDocument();
  });

  test('the close-reason popup closes when the conversation changes', async () => {
    const CONVERSATION_A = { id: 'c1', status: 'waiting', assignedAgentId: null };
    const CONVERSATION_B = { id: 'c2', status: 'waiting', assignedAgentId: null };
    const { rerender } = render(<ConversationView conversation={CONVERSATION_A} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();

    rerender(<ConversationView conversation={CONVERSATION_B} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText('Motivo do contato')).not.toBeInTheDocument();
  });
});
