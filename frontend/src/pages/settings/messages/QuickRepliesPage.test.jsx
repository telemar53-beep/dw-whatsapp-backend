import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../../../test-utils/renderInShell';
import QuickRepliesPage from './QuickRepliesPage';
import { useQuickReplies } from '../../../hooks/useQuickReplies';
import { useAuth } from '../../../contexts/AuthContext';
import * as api from '../../../services/api';

vi.mock('../../../hooks/useQuickReplies');
vi.mock('../../../contexts/AuthContext');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { role: 'admin' } });
});

describe('QuickRepliesPage', () => {
  // Restaura o antigo popup "O que é isso: respostas rápidas" (SectionHelp) do
  // MessagesAdminTab como um Card sempre visível no topo da página — mesmo texto
  // e mesmo exemplo, sem precisar clicar em nada para revelá-los.
  test('shows the explanation and example for the quick-reply feature directly, without a popup', () => {
    useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<QuickRepliesPage />, { path: '/configuracoes/mensagens/respostas-rapidas' });

    expect(screen.getByText(/mensagens prontas que o atendente pode inserir com um clique/i)).toBeInTheDocument();
    expect(screen.getByText(/poderia me informar seu/i)).toBeInTheDocument();
  });

  // Adaptado: o antigo popup "Ver mensagens" some — a lista de respostas
  // rápidas cadastradas agora aparece direto na página.
  test('lists existing quick replies directly on the page, without a Ver mensagens popup', () => {
    useQuickReplies.mockReturnValue({
      quickReplies: [{ id: 'qr-1', title: 'Boas-vindas', content: 'Olá!' }],
      status: 'ready',
      refresh: vi.fn(),
    });
    renderInShell(<QuickRepliesPage />, { path: '/configuracoes/mensagens/respostas-rapidas' });

    expect(screen.getByText('Boas-vindas')).toBeInTheDocument();
    expect(screen.getByText('Olá!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver mensagens/i })).not.toBeInTheDocument();
  });

  test('does not show the quick-reply create form until its button is clicked', () => {
    useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<QuickRepliesPage />, { path: '/configuracoes/mensagens/respostas-rapidas' });

    expect(screen.queryByText(/cadastrar nova resposta rápida/i)).not.toBeInTheDocument();
  });

  test('creating a quick reply opens the form, saves, refreshes, and closes the form', async () => {
    const refresh = vi.fn();
    useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh });
    api.createQuickReply.mockResolvedValue({ id: 'qr-2', title: 'Nova', content: 'Texto' });
    renderInShell(<QuickRepliesPage />, { path: '/configuracoes/mensagens/respostas-rapidas' });

    await userEvent.click(screen.getByRole('button', { name: /criar resposta rápida/i }));
    await userEvent.type(screen.getByLabelText(/título/i), 'Nova');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Texto');
    await userEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }));

    await waitFor(() => expect(api.createQuickReply).toHaveBeenCalledWith({ title: 'Nova', content: 'Texto' }, 'tok-123'));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText(/cadastrar nova resposta rápida/i)).not.toBeInTheDocument();
  });

  test('canceling the create form hides it without creating anything', async () => {
    useQuickReplies.mockReturnValue({ quickReplies: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<QuickRepliesPage />, { path: '/configuracoes/mensagens/respostas-rapidas' });

    await userEvent.click(screen.getByRole('button', { name: /criar resposta rápida/i }));
    expect(screen.getByText(/cadastrar nova resposta rápida/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByText(/cadastrar nova resposta rápida/i)).not.toBeInTheDocument();
    expect(api.createQuickReply).not.toHaveBeenCalled();
  });
});
