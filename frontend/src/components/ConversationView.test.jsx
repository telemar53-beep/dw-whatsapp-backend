import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationView from './ConversationView';
import { useAuth } from '../contexts/AuthContext';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useCities } from '../hooks/useCities';
import { useSgpLookup } from '../hooks/useSgpLookup';
import { useReasons } from '../hooks/useReasons';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useCities');
vi.mock('../hooks/useSgpLookup');
vi.mock('../hooks/useReasons');
vi.mock('../hooks/useAiSuggestion');
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
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  // O aviso do topo do chat cita a empresa cadastrada, pela rota pública: o
  // atendente comum não pode chamar a rota de admin.
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
});

describe('ConversationView', () => {
  test('mostra apenas os dados disponíveis do cliente no painel contextual', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Ana', contactCityName: 'São Paulo', sectorName: 'Financeiro', protocolNumber: '123' }}
        onTransferClick={vi.fn()}
        workspace
      />
    );
    const panel = screen.getByRole('complementary', { name: 'Dados do cliente' });
    expect(within(panel).getByText('São Paulo')).toBeInTheDocument();
    expect(within(panel).getByText('Financeiro')).toBeInTheDocument();
    expect(within(panel).getByText('123')).toBeInTheDocument();
    expect(within(panel).queryByText('CPF')).not.toBeInTheDocument();
  });

  test('permite fechar e reabrir os dados do cliente sem alterar a conversa', async () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', contactDisplayName: 'Ana' }} onTransferClick={vi.fn()} workspace />);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar dados do cliente' }));
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' }).parentElement).toHaveClass('is-dismissed');
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
    expect(screen.getByRole('complementary', { name: 'Dados do cliente' }).parentElement).not.toHaveClass('is-dismissed');
  });

  // O nome do provedor e configuracao: o sistema roda em mais de uma empresa.
  test('o aviso do topo cita a empresa cadastrada', async () => {
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(await screen.findByText('Este atendimento fica registrado no sistema da Provedor X.')).toBeInTheDocument();
  });

  test('sem empresa cadastrada, o aviso do topo fica generico', async () => {
    api.getPublicCompany.mockResolvedValue({ name: '' });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);
    expect(await screen.findByText('Este atendimento fica registrado no sistema da empresa.')).toBeInTheDocument();
  });

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

  test('shows an "IA" marker on an outbound message sent by the AI', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'outbound', content: 'Vou te ajudar com isso.', status: 'delivered', sentBy: 'ai' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('IA')).toBeInTheDocument();
  });

  test('shows no "IA" marker on an outbound message sent by a human', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'outbound', content: 'Vou te ajudar com isso.', status: 'delivered', sentBy: 'human' }],
      sendMessage: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByText('IA')).not.toBeInTheDocument();
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

  test('shows the Portuguese explanation for a failed message with a mapped Meta error code', () => {
    useConversationMessages.mockReturnValue({
      messages: [{
        id: 'm1', direction: 'outbound', content: 'Promoção de aniversário', status: 'failed',
        metadata: { motivoFalha: '(131049) Marketing message limit reached' },
      }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }} onTransferClick={vi.fn()} />);
    expect(screen.getByText(
      'Não entregue: A Meta limitou mensagens de marketing para este contato (baixo engajamento). Tente um template de utilidade ou espere o cliente responder (código 131049)'
    )).toBeInTheDocument();
  });

  test('shows just "Não entregue" for a failed message with no motivoFalha', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'outbound', content: 'Oi', status: 'failed' }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }} onTransferClick={vi.fn()} />);
    expect(screen.getByText('Não entregue')).toBeInTheDocument();
  });

  test('shows no failure line on a delivered outbound message', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'outbound', content: 'Oi', status: 'delivered' }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }} onTransferClick={vi.fn()} />);
    expect(screen.queryByText(/Não entregue/)).not.toBeInTheDocument();
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

  test('renders an outbound Pix message as a native card, without showing the raw code as text', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        {
          id: 'm1',
          direction: 'outbound',
          messageType: 'pix',
          content: '000201ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          metadata: { value: 135, dueDate: '2026-09-15' },
        },
      ],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }} onTransferClick={vi.fn()} />);

    // RTL normaliza espaços (inclusive o nbsp que o Intl usa entre "R$" e o valor)
    // ao ler o texto do DOM, então a expectativa precisa passar pela mesma normalização.
    const expectedValue = Number(135)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      .replace(/ /g, ' ');
    expect(screen.getByText('Pix da fatura')).toBeInTheDocument();
    expect(screen.getByText(expectedValue)).toBeInTheDocument();
    expect(screen.getByText('15/09/2026')).toBeInTheDocument();
    expect(screen.queryByText(/0123456789/)).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i }));

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
    expect(screen.queryByRole('button', { name: /encerrar atendimento/i })).not.toBeInTheDocument();
  });

  test('shows Transferir and Fechar to an admin viewing a conversation assigned to another agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeInTheDocument();
  });

  test('shows Transferir and Fechar to a manager viewing a conversation assigned to another agent', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'manager-1', role: 'manager' } });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeInTheDocument();
  });

  test('an admin does not see Transferir or Fechar on an already-closed conversation', () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'closed', assignedAgentId: 'agent-OTHER' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /encerrar atendimento/i })).not.toBeInTheDocument();
  });

  test('shows Transferir and Fechar for a waiting conversation too, without needing to claim it first', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /encerrar atendimento/i })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i }));

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
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    await userEvent.click(screen.getByLabelText('Troca de senha'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i }));

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

  test('shows "Mídia" as the quoted preview when the quoted message has no text content (photo, audio, sticker)', () => {
    useConversationMessages.mockReturnValue({
      messages: [
        {
          id: 'm2',
          direction: 'inbound',
          content: 'Isso mesmo',
          repliedToPreview: { content: null, direction: 'outbound' },
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
    expect(screen.getByText('Mídia')).toBeInTheDocument();
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

  test('abre o painel do SGP sozinho quando o contato tem CPF vinculado', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null, contactSgpDocument: '11122233344' }}
        onTransferClick={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText('Consultar SGP')).toBeInTheDocument();
    expect(screen.getByLabelText(/cpf do cliente/i)).toHaveValue('11122233344');
  });

  test('não abre o painel do SGP quando o contato não tem CPF vinculado', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null, contactSgpDocument: null }}
        onTransferClick={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.queryByText('Consultar SGP')).not.toBeInTheDocument();
  });

  test('clicking "Cód Pix" no painel do SGP chama sendSgpPix e adiciona as duas mensagens na conversa', async () => {
    const appendMessage = vi.fn();
    useConversationMessages.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      appendMessage,
    });
    useSgpLookup.mockReturnValue({
      client: { id: 1, name: 'Cliente Exemplo', document: '036.668.113-37' },
      contracts: [{ id: 555, status: 'Ativo', plan: '1GB' }],
      loading: false,
      error: null,
      search: vi.fn(),
      fetchDuplicate: vi.fn(),
      duplicateState: {
        555: {
          loading: false,
          error: null,
          hasOpenInvoice: true,
          duplicates: [
            { id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' },
          ],
        },
      },
    });
    const messagesReturned = [{ id: 'msg1' }, { id: 'msg2' }];
    api.sendSgpPix.mockResolvedValue(messagesReturned);

    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null, contactSgpDocument: '11122233344' }}
        onTransferClick={vi.fn()}
        onBack={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /cód pix/i }));

    // faturaId acompanha o envio para virar o "Nº da cobrança" no cartão nativo de Pix.
    await waitFor(() =>
      expect(api.sendSgpPix).toHaveBeenCalledWith(
        555,
        'c1',
        { pixCode: '000201...', value: 89.9, dueDate: '2026-09-20', faturaId: '999' },
        'tok-123'
      )
    );
    expect(appendMessage).toHaveBeenCalledWith(messagesReturned[0]);
    expect(appendMessage).toHaveBeenCalledWith(messagesReturned[1]);
  });

  test('the close-reason popup closes when the conversation changes', async () => {
    const CONVERSATION_A = { id: 'c1', status: 'waiting', assignedAgentId: null };
    const CONVERSATION_B = { id: 'c2', status: 'waiting', assignedAgentId: null };
    const { rerender } = render(<ConversationView conversation={CONVERSATION_A} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));
    expect(screen.getByText('Motivo do contato')).toBeInTheDocument();

    rerender(<ConversationView conversation={CONVERSATION_B} onTransferClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByText('Motivo do contato')).not.toBeInTheDocument();
  });
});

describe('AI suggestion card', () => {
  // Fix 8 (final review): useAiSuggestion(conversation.id) fired unconditionally,
  // so every conversation opened called GET /:id/ai-suggestion — including when
  // the attendant is not the assigned agent (a 403 in the logs) and when the AI
  // is off entirely. Guarded with the same isMine condition that gates the
  // card's rendering.
  test('does not fetch the AI suggestion when the conversation is not assigned to me', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(useAiSuggestion).toHaveBeenCalledWith(null);
  });

  test('fetches the AI suggestion when the conversation is mine', () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(useAiSuggestion).toHaveBeenCalledWith('c1');
  });

  test('shows the AI suggestion card above the message input when there is one pending', () => {
    useAiSuggestion.mockReturnValue({
      suggestion: { id: 's-1', content: 'Seu plano é 600MB.' },
      send: vi.fn(),
      edit: vi.fn(),
      discard: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.getByText('Seu plano é 600MB.')).toBeInTheDocument();
    expect(screen.getByText(/sugestão da ia/i)).toBeInTheDocument();
  });

  test('does not show the AI suggestion card when the conversation is not assigned to me', () => {
    useAiSuggestion.mockReturnValue({
      suggestion: { id: 's-1', content: 'Seu plano é 600MB.' },
      send: vi.fn(),
      edit: vi.fn(),
      discard: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'waiting', assignedAgentId: null }}
        onTransferClick={vi.fn()}
      />
    );
    expect(screen.queryByText('Seu plano é 600MB.')).not.toBeInTheDocument();
  });

  test('clicking Enviar on the AI suggestion card calls the hook\'s send with that suggestion', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    useAiSuggestion.mockReturnValue({
      suggestion: { id: 's-1', content: 'Seu plano é 600MB.' },
      send,
      edit: vi.fn(),
      discard: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));

    expect(send).toHaveBeenCalledWith({ id: 's-1', content: 'Seu plano é 600MB.' });
  });

  test('clicking Descartar on the AI suggestion card calls the hook\'s discard with that suggestion', async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    useAiSuggestion.mockReturnValue({
      suggestion: { id: 's-1', content: 'Seu plano é 600MB.' },
      send: vi.fn(),
      edit: vi.fn(),
      discard,
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /descartar/i }));

    expect(discard).toHaveBeenCalledWith({ id: 's-1', content: 'Seu plano é 600MB.' });
  });

  test('clicking Editar loads the suggested text into the message box, including line breaks, without sending or discarding', async () => {
    const edit = vi.fn().mockReturnValue('Primeira linha\nSegunda linha');
    const send = vi.fn();
    const discard = vi.fn();
    useAiSuggestion.mockReturnValue({
      suggestion: { id: 's-1', content: 'Primeira linha\nSegunda linha' },
      send,
      edit,
      discard,
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    expect(edit).toHaveBeenCalledWith({ id: 's-1', content: 'Primeira linha\nSegunda linha' });
    expect(send).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/digite uma mensagem/i)).toHaveValue('Primeira linha\nSegunda linha');
  });

  test('passes the AI-suggested reason through to the close-reason popup, pre-selecting it', async () => {
    useReasons.mockReturnValue({
      reasons: [
        { id: 'r1', name: 'Troca de senha', active: true },
        { id: 'r2', name: 'Sem conexão', active: true },
      ],
      loading: false,
      refresh: vi.fn(),
    });
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', suggestedReasonId: 'r2' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(screen.getByLabelText('Sem conexão')).toBeChecked();
  });

  test('opens the close-reason popup with nothing pre-selected when there is no AI-suggested reason', async () => {
    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }));

    expect(screen.getByLabelText('Troca de senha')).not.toBeChecked();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /encerrar atendimento/i })).toBeDisabled();
  });

  // These four tests use mockImplementation with a mutable closure variable, instead of a
  // static mockReturnValue, so that calling the mocked edit() can make the mocked suggestion
  // disappear on the next render — mirroring what the real hook does (edit clears its state
  // synchronously) and letting the card give way to the composer's own "Enviar" button, the
  // same way the real hook wiring depends on.
  test('a plain-text send after editing a suggestion goes through the suggestion route, with the edited content', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn();
    const sendMessageMock = vi.fn().mockResolvedValue({});
    let currentSuggestion = { id: 's-1', content: 'Seu plano é 600MB.' };
    const edit = vi.fn((item) => {
      currentSuggestion = null;
      return item.content;
    });
    useAiSuggestion.mockImplementation(() => ({ suggestion: currentSuggestion, send, edit, discard }));
    useConversationMessages.mockReturnValue({ messages: [], sendMessage: sendMessageMock });

    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const textbox = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.clear(textbox);
    await userEvent.type(textbox, 'Texto editado pelo atendente');
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ id: 's-1', content: 'Seu plano é 600MB.' }, 'Texto editado pelo atendente')
    );
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  test('sending an attachment after editing a suggestion discards it first, then sends normally', async () => {
    const send = vi.fn();
    const discard = vi.fn().mockResolvedValue(undefined);
    const sendMessageMock = vi.fn().mockResolvedValue({});
    let currentSuggestion = { id: 's-1', content: 'Seu plano é 600MB.' };
    const edit = vi.fn((item) => {
      currentSuggestion = null;
      return item.content;
    });
    useAiSuggestion.mockImplementation(() => ({ suggestion: currentSuggestion, send, edit, discard }));
    useConversationMessages.mockReturnValue({ messages: [], sendMessage: sendMessageMock });

    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));
    const fakeFile = new File(['bytes'], 'foto.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]');
    await userEvent.upload(fileInput, fakeFile);
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));

    await waitFor(() => expect(discard).toHaveBeenCalledWith({ id: 's-1', content: 'Seu plano é 600MB.' }));
    expect(send).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith('Seu plano é 600MB.', fakeFile, null, false);
  });

  test('switching to a different conversation clears the pending edited suggestion', async () => {
    const send = vi.fn();
    const sendMessageMock = vi.fn().mockResolvedValue({});
    let currentSuggestion = { id: 's-1', content: 'Seu plano é 600MB.' };
    const edit = vi.fn((item) => {
      currentSuggestion = null;
      return item.content;
    });
    useAiSuggestion.mockImplementation(() => ({ suggestion: currentSuggestion, send, edit, discard: vi.fn() }));
    useConversationMessages.mockReturnValue({ messages: [], sendMessage: sendMessageMock });

    const { rerender } = render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }));

    rerender(
      <ConversationView
        conversation={{ id: 'c2', status: 'assigned', assignedAgentId: 'agent-1' }}
        onTransferClick={vi.fn()}
      />
    );

    const textbox = screen.getByPlaceholderText(/digite uma mensagem/i);
    await userEvent.clear(textbox);
    await userEvent.type(textbox, 'Mensagem nova');
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith('Mensagem nova', null, null, false));
    expect(send).not.toHaveBeenCalled();
  });
});

// A atendente descobria a janela de 24 h só depois de escrever e enviar, pela
// falha em vermelho — e no caso real mandou duas vezes, porque a primeira
// falha não explicava o que fazer. O aviso vem antes, mas não bloqueia: o
// nosso relógio pode divergir do da Meta por alguns minutos, e impedir um
// envio que passaria seria pior do que deixar tentar.
describe('aviso da janela de 24 horas', () => {
  const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', channelType: 'meta_cloud' };

  function comMensagens(messages) {
    useConversationMessages.mockReturnValue({ messages, sendMessage: vi.fn() });
  }

  function horasAtras(horas) {
    return new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
  }

  test('avisa quando o cliente não responde há mais de 24 horas', () => {
    comMensagens([{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: horasAtras(25) }]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByText(/janela de 24h fechada/i)).toBeInTheDocument();
  });

  test('não avisa quando o cliente respondeu há pouco', () => {
    comMensagens([{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: horasAtras(2) }]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();
  });

  // O caso do print: a atendente iniciou com template e o cliente não respondeu.
  test('avisa quando só nós falamos, porque template não abre a janela', () => {
    comMensagens([{ id: 'm1', direction: 'outbound', content: 'Olá!', createdAt: horasAtras(1) }]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByText(/janela de 24h fechada/i)).toBeInTheDocument();
  });

  test('não avisa nada num canal Baileys, que não tem essa regra', () => {
    comMensagens([{ id: 'm1', direction: 'outbound', content: 'Olá!', createdAt: horasAtras(30) }]);
    render(<ConversationView conversation={{ ...MINHA, channelType: 'baileys' }} onTransferClick={vi.fn()} />);

    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();
  });

  test('o campo de mensagem continua disponível apesar do aviso', () => {
    comMensagens([{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: horasAtras(25) }]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByPlaceholderText('Digite uma mensagem...')).not.toBeDisabled();
  });
});

// O aviso mandava "use um template aprovado", mas nao havia botao para isso em
// conversa aberta — so em "Iniciar conversa". O atendente lia a instrucao e
// ficava sem acao.
describe('enviar template com a janela fechada', () => {
  const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', channelType: 'meta_cloud', channelId: 'ch-1' };
  const TEMPLATE = { id: 'tpl-1', name: 'retorno', language: 'pt_BR', bodyText: 'Olá {{1}}, tudo bem?', variableCount: 1, status: 'APPROVED' };

  function janelaFechada() {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() }],
      sendMessage: vi.fn(),
    });
  }

  test('oferece enviar template quando a janela esta fechada', () => {
    janelaFechada();
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByRole('button', { name: /enviar template/i })).toBeInTheDocument();
  });

  test('nao oferece com a janela aberta', () => {
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date().toISOString() }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /enviar template/i })).not.toBeInTheDocument();
  });

  // A separacao de finalidade feita hoje serve exatamente aqui: template de
  // disparo nao e para conversa individual.
  test('lista so os templates de atendimento do canal', async () => {
    janelaFechada();
    api.listTemplatesForChannel.mockResolvedValue([TEMPLATE]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /enviar template/i }));

    await waitFor(() => expect(api.listTemplatesForChannel).toHaveBeenCalledWith('ch-1', 'tok-123', 'atendimento'));
  });

  test('envia o template com a variavel preenchida', async () => {
    janelaFechada();
    api.listTemplatesForChannel.mockResolvedValue([TEMPLATE]);
    api.sendConversationTemplate.mockResolvedValue({ id: 'msg-1' });
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /enviar template/i }));
    await userEvent.click(await screen.findByText('retorno'));
    await userEvent.type(screen.getByLabelText(/variável 1/i), 'Maria');
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));

    await waitFor(() => expect(api.sendConversationTemplate).toHaveBeenCalledWith('c1', 'tpl-1', ['Maria'], 'tok-123'));
  });
});

// Uma mensagem com data ausente ou ilegível não criava separador nenhum e era
// desenhada sob o cabeçalho do dia ANTERIOR: a bolha aparecia num dia que não é
// o dela, sem nada na tela dizendo isso.
describe('cabeçalho de dia com data ilegível', () => {
  const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', channelType: 'baileys' };

  function comMensagens(messages) {
    useConversationMessages.mockReturnValue({ messages, sendMessage: vi.fn() });
  }

  function ordemDe(container, trecho, ultima = false) {
    const texto = container.textContent;
    return ultima ? texto.lastIndexOf(trecho) : texto.indexOf(trecho);
  }

  test('mensagem sem data legível ganha grupo próprio, não entra no dia anterior', () => {
    comMensagens([
      { id: 'm1', direction: 'inbound', content: 'Mensagem com data', createdAt: new Date().toISOString() },
      { id: 'm2', direction: 'inbound', content: 'Mensagem sem data', createdAt: 'data-invalida' },
    ]);
    const { container } = render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByText('Data desconhecida')).toBeInTheDocument();
    expect(ordemDe(container, 'Hoje')).toBeLessThan(ordemDe(container, 'Mensagem com data'));
    expect(ordemDe(container, 'Mensagem com data')).toBeLessThan(ordemDe(container, 'Data desconhecida'));
    expect(ordemDe(container, 'Data desconhecida')).toBeLessThan(ordemDe(container, 'Mensagem sem data'));
  });

  // startOfDay(new Date('lixo')) devolve NaN em vez de lançar, e um createdAt
  // nulo viraria 1970: os três casos têm que cair no mesmo grupo visível.
  test('data ausente, nula ou vazia também cai no grupo desconhecido', () => {
    for (const ruim of [undefined, null, '']) {
      comMensagens([{ id: 'm1', direction: 'inbound', content: 'Sem data nenhuma', createdAt: ruim }]);
      const { unmount } = render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);
      expect(screen.getByText('Data desconhecida')).toBeInTheDocument();
      expect(screen.queryByText('01/01/1970')).not.toBeInTheDocument();
      unmount();
    }
  });

  test('a mensagem válida seguinte volta para o agrupamento da data dela', () => {
    comMensagens([
      { id: 'm1', direction: 'inbound', content: 'Primeira', createdAt: new Date().toISOString() },
      { id: 'm2', direction: 'inbound', content: 'Sem data', createdAt: 'data-invalida' },
      { id: 'm3', direction: 'inbound', content: 'Terceira', createdAt: new Date().toISOString() },
    ]);
    const { container } = render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    // Dois cabeçalhos "Hoje": a terceira não ficou presa no grupo desconhecido.
    expect(screen.getAllByText('Hoje')).toHaveLength(2);
    expect(ordemDe(container, 'Sem data')).toBeLessThan(ordemDe(container, 'Hoje', true));
    expect(ordemDe(container, 'Hoje', true)).toBeLessThan(ordemDe(container, 'Terceira'));
  });

  // É um GRUPO, não um cabeçalho por mensagem: duas seguidas sem data legível
  // ficam sob o mesmo "Data desconhecida".
  test('mensagens seguidas sem data dividem um único cabeçalho', () => {
    comMensagens([
      { id: 'm1', direction: 'inbound', content: 'Sem data A', createdAt: 'data-invalida' },
      { id: 'm2', direction: 'inbound', content: 'Sem data B', createdAt: null },
    ]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getAllByText('Data desconhecida')).toHaveLength(1);
  });

  test('mensagem de ontem com data válida continua com o cabeçalho normal', () => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    comMensagens([{ id: 'm1', direction: 'inbound', content: 'De ontem', createdAt: ontem.toISOString() }]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByText('Ontem')).toBeInTheDocument();
    expect(screen.queryByText('Data desconhecida')).not.toBeInTheDocument();
  });
});

// "Ontem" é o dia ANTERIOR no calendário, não "86.400.000 ms atrás". Nos dois
// casos abaixo o relógio local anda 25 h entre uma meia-noite e a seguinte (fim
// de horário de verão), e a subtração em milissegundos cai no dia errado. São
// datas reais: Reino Unido em 31/10/2021 e Bangladesh em 31/12/2009.
describe('cabeçalho "Ontem" na virada de mês e de ano', () => {
  const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', channelType: 'baileys' };
  const TZ_ORIGINAL = process.env.TZ;

  afterEach(() => {
    vi.useRealTimers();
    if (TZ_ORIGINAL === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIGINAL;
  });

  function renderizaCom(tz, hoje, ontem) {
    // O fuso primeiro: as datas abaixo são construídas no calendário local.
    process.env.TZ = tz;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(...hoje));
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Mensagem', createdAt: new Date(...ontem).toISOString() }],
      sendMessage: vi.fn(),
    });
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);
  }

  test('virada de mês: 31/10 continua sendo "Ontem" em 1º/11', () => {
    renderizaCom('Europe/London', [2021, 10, 1, 10, 0, 0], [2021, 9, 31, 20, 0, 0]);

    expect(screen.getByText('Ontem')).toBeInTheDocument();
  });

  test('virada de ano: 31/12 continua sendo "Ontem" em 1º/01', () => {
    renderizaCom('Asia/Dhaka', [2010, 0, 1, 10, 0, 0], [2009, 11, 31, 20, 0, 0]);

    expect(screen.getByText('Ontem')).toBeInTheDocument();
  });

  test('o dia de hoje continua sendo "Hoje" nos mesmos fusos', () => {
    renderizaCom('Europe/London', [2021, 10, 1, 10, 0, 0], [2021, 10, 1, 9, 0, 0]);

    expect(screen.getByText('Hoje')).toBeInTheDocument();
  });
});

// O estado da janela não pode ser decidido por um `now` capturado na
// renderização: um chat aberto desde cedo continuava dizendo "aberta" muito
// depois de a janela ter fechado, e só o F5 corrigia.
describe('recálculo da janela de 24 horas', () => {
  const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', channelType: 'meta_cloud', channelId: 'ch-1' };

  afterEach(() => {
    vi.useRealTimers();
  });

  function quaseFechando() {
    // 23 h 59 min: falta um minuto para a janela fechar.
    useConversationMessages.mockReturnValue({
      messages: [
        { id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date(Date.now() - (24 * 60 - 1) * 60000).toISOString() },
      ],
      sendMessage: vi.fn(),
    });
  }

  test('a passagem do tempo fecha a janela sem recarregar a página', async () => {
    vi.useFakeTimers();
    quaseFechando();
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60000);
    });

    expect(screen.getByText(/janela de 24h fechada/i)).toBeInTheDocument();
  });

  // Aqui o relógio anda SEM nenhum disparo de temporizador: se o aviso aparecer
  // depois do envio, foi o envio que refez a conta — não um `now` de render.
  test('no envio, o estado é recalculado com a hora de agora', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn();
    useConversationMessages.mockReturnValue({
      messages: [
        { id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString() },
      ],
      sendMessage,
    });
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();

    // Duas horas passam sem que nenhum temporizador rode.
    vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Digite uma mensagem...'), { target: { value: 'Alguma coisa' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Enviar'));
    });

    expect(sendMessage).toHaveBeenCalled();
    expect(screen.getByText(/janela de 24h fechada/i)).toBeInTheDocument();
  });

  // Nada aqui remonta ao trocar de conversa: sem limpar, o relógio do cliente
  // anterior continuaria valendo para o próximo.
  test('trocar de conversa reinicia o relógio em vez de herdar o anterior', async () => {
    vi.useFakeTimers();
    const inicio = Date.now();
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date(inicio).toISOString() }],
      sendMessage: vi.fn(),
    });
    const { rerender } = render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();

    // O tempo anda sem nenhum temporizador rodar: o relógio da tela envelhece.
    vi.setSystemTime(new Date(inicio + 25 * 60 * 60 * 1000));

    // Outro cliente, que falou pela última vez no mesmo instante — só que esse
    // instante agora está a 25 h de distância.
    useConversationMessages.mockReturnValue({
      messages: [{ id: 'm9', direction: 'inbound', content: 'Oi', createdAt: new Date(inicio).toISOString() }],
      sendMessage: vi.fn(),
    });
    await act(async () => {
      rerender(<ConversationView conversation={{ ...MINHA, id: 'c2' }} onTransferClick={vi.fn()} />);
    });

    // Herdar o relógio do cliente anterior diria "aberta" para este.
    expect(screen.getByText(/janela de 24h fechada/i)).toBeInTheDocument();
  });
});

// O estado indeterminado existe para não mentir: a inbound mais recente está lá
// mas a data dela não dá para ler. Nele a tela não bloqueia, não promete que a
// janela está aberta e não anuncia que está fechada.
describe('janela de 24 horas indeterminada', () => {
  const MINHA = { id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', channelType: 'meta_cloud', channelId: 'ch-1' };

  function comDataIlegivel(extras = []) {
    useConversationMessages.mockReturnValue({
      messages: [
        { id: 'm1', direction: 'inbound', content: 'Oi', createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() },
        { id: 'm2', direction: 'inbound', content: 'Segunda', createdAt: 'data-invalida' },
        ...extras,
      ],
      sendMessage: vi.fn(),
    });
  }

  test('avisa de forma neutra, sem dizer aberta nem fechada', () => {
    comDataIlegivel();
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByText(/não foi possível conferir a janela de 24h/i)).toBeInTheDocument();
    expect(screen.queryByText(/janela de 24h fechada/i)).not.toBeInTheDocument();
  });

  test('não bloqueia o campo de mensagem', () => {
    comDataIlegivel();
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByPlaceholderText('Digite uma mensagem...')).not.toBeDisabled();
  });

  // A decisão final é do canal: enquanto ele não recusou, não há por que
  // empurrar o atendente para o template.
  test('não oferece template só por estar indeterminada', () => {
    comDataIlegivel();
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /enviar template/i })).not.toBeInTheDocument();
  });

  test('oferece o template depois de o canal recusar por janela de 24 h', () => {
    comDataIlegivel([
      {
        id: 'm3',
        direction: 'outbound',
        content: 'Tentativa',
        status: 'failed',
        createdAt: new Date().toISOString(),
        metadata: { motivoFalha: '(131047) Message failed to send because more than 24 hours have passed.' },
      },
    ]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.getByRole('button', { name: /enviar template/i })).toBeInTheDocument();
  });

  // Outra falha qualquer não é recusa por janela e não muda nada.
  test('falha por outro motivo não vira oferta de template', () => {
    comDataIlegivel([
      {
        id: 'm3',
        direction: 'outbound',
        content: 'Tentativa',
        status: 'failed',
        createdAt: new Date().toISOString(),
        metadata: { motivoFalha: '(131026) Número não recebe mensagens.' },
      },
    ]);
    render(<ConversationView conversation={MINHA} onTransferClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /enviar template/i })).not.toBeInTheDocument();
  });

  test('canal não oficial nunca entra em indeterminada', () => {
    comDataIlegivel();
    render(<ConversationView conversation={{ ...MINHA, channelType: 'baileys' }} onTransferClick={vi.fn()} />);

    expect(screen.queryByText(/não foi possível conferir a janela de 24h/i)).not.toBeInTheDocument();
  });
});

describe('carregamento do histórico da conversa', () => {
  test('falha ao carregar mostra aviso e oferece tentar de novo', async () => {
    const reloadMessages = vi.fn();
    useConversationMessages.mockReturnValue({
      messages: [],
      status: 'error',
      reloadMessages,
      sendMessage: vi.fn(),
    });

    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Ana' }}
        onTransferClick={vi.fn()}
        workspace
      />
    );

    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent(/não foi possível carregar as mensagens/i);

    await userEvent.click(within(aviso).getByRole('button', { name: /tentar de novo/i }));
    expect(reloadMessages).toHaveBeenCalledTimes(1);
  });

  test('conversa realmente sem mensagens não mostra o aviso de falha', () => {
    useConversationMessages.mockReturnValue({
      messages: [],
      status: 'ready',
      reloadMessages: vi.fn(),
      sendMessage: vi.fn(),
    });

    render(
      <ConversationView
        conversation={{ id: 'c1', status: 'assigned', assignedAgentId: 'agent-1', contactDisplayName: 'Ana' }}
        onTransferClick={vi.fn()}
        workspace
      />
    );

    expect(screen.queryByText(/não foi possível carregar as mensagens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/carregando mensagens/i)).not.toBeInTheDocument();
  });
});
