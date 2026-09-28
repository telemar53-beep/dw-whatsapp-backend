import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from './DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { closeConversation, getQueue, getMyConversations, updateContact, listCities } from '../services/api';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
  // Só usados quando um teste roda os hooks de lista de verdade (edição do
  // contato); os outros simulam os hooks e nunca chegam aqui.
  getQueue: vi.fn(),
  getMyConversations: vi.fn(),
  updateContact: vi.fn(),
  listCities: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready' }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');
vi.mock('../components/StartConversationModal', () => ({
  default: ({ onCreated }) => (
    <button
      onClick={() =>
        onCreated({ id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' })
      }
    >
      Mock Start Conversation
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
  closeConversation.mockResolvedValue({ id: 'c1', status: 'closed' });
  useCompanyName.mockReturnValue({ name: 'Net Fibra', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
});

// Sem ResizeObserver (jsdom), useWorkspaceLayout mede pela janela. É assim que
// os testes escolhem o modo da mesa.
const LARGURA_PADRAO = window.innerWidth;
function larguraDaJanela(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}
afterEach(() => larguraDaJanela(LARGURA_PADRAO));

function renderDashboard() {
  return renderInShell(<DashboardPage />);
}

describe('DashboardPage', () => {
  // A tela vazia dizia "DW Telecom Atendimento": nome de provedor nenhum fica
  // no código.
  test('a tela sem conversa selecionada cita a empresa cadastrada', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByText('Net Fibra · Atendimento')).toBeInTheDocument();
  });

  test('em carregamento não mostra "Atendimento" genérico', () => {
    useCompanyName.mockReturnValue({ name: '', status: 'loading' });
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    // A aba "Atendimento" existe sempre na lista; o que não pode aparecer é o título da tela vazia.
    const emptyState = within(screen.getByRole('main'));
    expect(emptyState.queryByText('Atendimento')).not.toBeInTheDocument();
    expect(emptyState.queryByText('Net Fibra · Atendimento')).not.toBeInTheDocument();
  });

  test('sem empresa cadastrada, a tela vazia mostra só Atendimento', () => {
    useCompanyName.mockReturnValue({ name: '', status: 'ready' });
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(within(screen.getByRole('main')).getByText('Atendimento')).toBeInTheDocument();
  });

  test('shows my conversations in the Atendimento tab by default', () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    renderDashboard();
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.queryByText('Carlos')).not.toBeInTheDocument();
  });

  test('exposes the tab strip as an ARIA tablist with the active tab marked aria-selected', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /atendimento/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /espera/i })).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));

    expect(screen.getByRole('tab', { name: /atendimento/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /espera/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('exposes the active tab\'s content as an ARIA tabpanel labelled by that tab', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    const tab = screen.getByRole('tab', { name: /atendimento/i });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  test('shows an unread indicator on a my-conversations item the hook reports as unread', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c2']), clearUnread: vi.fn() });
    renderDashboard();
    expect(screen.getByTitle('Mensagem não lida')).toBeInTheDocument();
  });

  test('clears the unread flag when the attendant selects that conversation', async () => {
    const clearUnread = vi.fn();
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c2']), clearUnread });
    renderDashboard();

    await userEvent.click(screen.getByText('Maria'));

    expect(clearUnread).toHaveBeenCalledWith('c2');
  });

  // `conversationOpen` significa "a conversa OCUPA A TELA INTEIRA", e não apenas
  // "existe conversa selecionada". A distinção não é cosmética: a casca esconde o
  // botão "Abrir menu" quando essa bandeira é verdadeira, e com o significado
  // antigo a única navegação do produto desaparecia em telas onde a lista ou o
  // rail continuavam visíveis — de 500 a 767px, e num desktop 1366x768 com zoom
  // de 200% (que vira uma viewport lógica de 683x384).
  //
  // A largura vem de `larguraDePalpite()` (window.innerWidth - 90), porque o
  // jsdom não tem ResizeObserver e o hook fica no palpite: dá para escolher o
  // layout de forma determinística.
  describe('conversationOpen avisa a casca que a conversa ocupa a tela', () => {
    const larguraOriginal = window.innerWidth;
    const definirJanela = (px) =>
      Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });

    function umaConversaMinha() {
      useQueue.mockReturnValue({ queue: [], status: 'ready' });
      useMyConversations.mockReturnValue({
        conversations: [{ id: 'c1', contactDisplayName: 'Ana', status: 'assigned', channelId: 'ch1' }],
        status: 'ready',
      });
    }

    afterEach(() => definirJanela(larguraOriginal));

    test('com a lista ainda visível, selecionar a conversa NÃO diz que ela ocupa a tela', async () => {
      definirJanela(1280); // 1190 úteis: cabem lista (332) e conversa (420) -> lista "expandida"
      umaConversaMinha();
      const { ctx } = renderInShell(<DashboardPage />);

      await userEvent.click(await screen.findByText('Ana'));

      expect(ctx.setConversationOpen).toHaveBeenLastCalledWith(false);
    });

    test('quando a lista fica oculta, selecionar a conversa diz que ela ocupa a tela', async () => {
      definirJanela(400); // 310 úteis: não cabem nem rail (72) e conversa (420) -> lista "oculta"
      umaConversaMinha();
      const { ctx } = renderInShell(<DashboardPage />);

      await userEvent.click(await screen.findByText('Ana'));

      expect(ctx.setConversationOpen).toHaveBeenLastCalledWith(true);
    });

    test('e selecionar a conversa continua abrindo a conversa, nas duas larguras', async () => {
      for (const largura of [1280, 400]) {
        definirJanela(largura);
        umaConversaMinha();
        const { unmount } = renderInShell(<DashboardPage />);

        await userEvent.click(await screen.findByText('Ana'));

        expect(await screen.findByRole('button', { name: 'Voltar para a lista' })).toBeInTheDocument();
        unmount();
      }
    });
  });

  test('shows the queue in the Espera tab after clicking it', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos' }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Maria' }], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));

    expect(screen.getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByText('Maria')).not.toBeInTheDocument();
  });

  test('separates conversations still in automatic triage into the Automação tab', async () => {
    useQueue.mockReturnValue({ queue: [
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
    expect(screen.queryByText('Em Triagem')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    expect(screen.getByText('Em Triagem')).toBeInTheDocument();
    expect(screen.queryByText('Aguardando')).not.toBeInTheDocument();
  });

  test('quick-closes a conversation from the Espera tab without asking for a reason', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar' }));

    expect(closeConversation).toHaveBeenCalledWith('c1', null, 'tok-123');
  });

  test('quick-closes a conversation from the Automação tab without asking for a reason', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar' }));

    expect(closeConversation).toHaveBeenCalledWith('c2', null, 'tok-123');
  });

  // A4-4: a confirmação espera a resposta. Antes ela fechava antes do
  // resultado e a falha sumia calada (`.catch(() => {})`).
  test('"Finalizar sem motivo" que falha mostra o erro na própria confirmação, que continua aberta', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    closeConversation.mockRejectedValueOnce({ body: { error: 'Conversation is closed' } });
    renderDashboard();

    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByRole('button', { name: /finalizar/i }));
    const confirmacao = await screen.findByRole('alertdialog', { name: 'Finalizar sem motivo?' });
    expect(confirmacao).toHaveTextContent('O atendimento de Carlos será finalizado sem informar o motivo.');
    await userEvent.click(within(confirmacao).getByRole('button', { name: 'Finalizar' }));

    expect(await within(confirmacao).findByRole('alert')).toHaveTextContent('Este atendimento já foi encerrado.');
    expect(screen.getByRole('alertdialog')).toBe(confirmacao);
    await userEvent.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(closeConversation).toHaveBeenCalledTimes(1);
  });

  test('does not show a quick-close button in the Atendimento tab', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c3', contactDisplayName: 'Minha' }], status: 'ready' });
    renderDashboard();

    expect(screen.queryByRole('button', { name: /finalizar/i })).not.toBeInTheDocument();
  });

  test('shows a badge with the count on each tab', () => {
    useQueue.mockReturnValue({ queue: [
      { id: 'c1', contactDisplayName: 'Aguardando', triageState: null },
      { id: 'c2', contactDisplayName: 'Em Triagem', triageState: 'pending' },
    ], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c3', contactDisplayName: 'Minha' }], status: 'ready' });
    renderDashboard();

    expect(screen.getByRole('tab', { name: /atendimento/i }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /espera/i }).textContent).toContain('1');
    expect(screen.getByRole('tab', { name: /automação/i }).textContent).toContain('1');
  });

  test('does not show a badge on a tab with no items', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    // Só o rótulo: nenhum número de contagem junto (o traço laranja da aba ativa não tem texto).
    expect(screen.getByRole('tab', { name: /atendimento/i }).textContent).toBe('Atendimento');
  });

  test('selecting a conversation from the Espera tab opens the conversation view', async () => {
    useQueue.mockReturnValue({ queue: [{ id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null }], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByText('Carlos'));
    expect(screen.getByRole('button', { name: /assumir/i })).toBeInTheDocument();
  });

  test('shows a placeholder when no conversation is selected', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'clica em "Meu perfil" chama onProfileClick'.
  test.skip('opens the profile modal from the header', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    expect(screen.queryByText(/meu perfil/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^meu perfil$/i }));

    expect(screen.getByText(/meu perfil/i)).toBeInTheDocument();
  });

  test('shows an Iniciar conversa button for any attendant', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByRole('button', { name: /nova conversa/i })).toBeInTheDocument();
  });

  test('starting a conversation opens it immediately, even before it appears in myConversations', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /nova conversa/i }));
    await userEvent.click(await screen.findByText('Mock Start Conversation'));

    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
  });

  test('clears the pending conversation once it appears in myConversations, so a later close is not masked by stale state', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    // rerender precisa da mesma casca de Outlet+context usada por renderInShell;
    // como o teste remonta a árvore inteira a cada rerender (já era assim antes
    // desta task, com um MemoryRouter novo por chamada), montamos a árvore aqui.
    const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn() };
    const shellTree = () => (
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={ctx} />}>
            <Route path="/" element={<DashboardPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(shellTree());

    await userEvent.click(screen.getByRole('button', { name: /nova conversa/i }));
    await userEvent.click(await screen.findByText('Mock Start Conversation'));
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue({ conversations: [
      { id: 'conv-new', contactPhoneNumber: '5598999990000', assignedAgentId: 'agent-1', status: 'assigned' },
    ], status: 'ready' });
    rerender(shellTree());
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    rerender(shellTree());
    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.getByText(/selecione uma conversa/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Modos da mesa. O jsdom não implementa ResizeObserver, então
  // useWorkspaceLayout cai no palpite (janela menos o menu) e a largura da
  // janela é o que escolhe o modo. A aritmética da decisão e o piso de 420px
  // da conversa são testados em useWorkspaceLayout.test.js; aqui o que importa
  // é o que a mesa faz em cada modo: qual modo ela declara, que lista entrega
  // e que caminho de volta oferece. A checagem de que nada fica espremido ou
  // sobreposto é visual e foi feita no navegador real.
  // ---------------------------------------------------------------------
  const CARLOS = { id: 'c1', contactDisplayName: 'Carlos', contactPhoneNumber: '5511999997777', status: 'waiting', assignedAgentId: null };

  function comFila() {
    useQueue.mockReturnValue({ queue: [CARLOS], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
  }

  async function abrirEspera() {
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
  }

  test('modo largo: lista inteira e conversa convivem em colunas', async () => {
    larguraDaJanela(1600);
    comFila();
    const { container } = renderDashboard();
    const mesa = container.querySelector('[data-lista]');
    const lista = container.querySelector('aside');

    expect(mesa).toHaveAttribute('data-lista', 'expandida');
    expect(mesa).toHaveAttribute('data-painel', 'coluna');
    // Lista inteira: o item traz o texto do contato, não só o avatar do rail.
    await abrirEspera();
    expect(within(lista).getByText('Carlos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver lista de atendimentos/i })).not.toBeInTheDocument();

    await userEvent.click(within(lista).getByRole('button', { name: /carlos/i }));

    // A conversa abriu e a lista continuou ali: nenhuma das duas sai de cena.
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(within(lista).getByText('Carlos')).toBeInTheDocument();
    expect(mesa).toHaveAttribute('data-lista', 'expandida');
  });

  test('modo rail: lista vira trilho com a seleção identificável e volta a abrir', async () => {
    larguraDaJanela(600);
    comFila();
    const { container } = renderDashboard();
    const mesa = container.querySelector('[data-lista]');
    const lista = container.querySelector('aside');

    expect(mesa).toHaveAttribute('data-lista', 'rail');
    await abrirEspera();

    // No trilho cada atendimento é um alvo com o nome na etiqueta acessível.
    const noTrilho = within(lista).getByRole('button', { name: 'Carlos' });
    expect(noTrilho).not.toHaveAttribute('aria-current');

    await userEvent.click(noTrilho);

    // Conversa aberta e seleção visível no trilho ao mesmo tempo.
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
    expect(within(lista).getByRole('button', { name: 'Carlos' })).toHaveAttribute('aria-current', 'true');

    // O trilho tem uma ação explícita para reabrir a lista inteira...
    await userEvent.click(screen.getByRole('button', { name: /ver lista de atendimentos/i }));
    expect(within(lista).getByText('Carlos')).toBeInTheDocument();

    // ...e um caminho de volta claro, que também é o que escolher outra
    // conversa faz sozinho.
    await userEvent.click(screen.getByRole('button', { name: /voltar à conversa/i }));
    expect(within(lista).getByRole('button', { name: 'Carlos' })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /voltar à conversa/i })).not.toBeInTheDocument();
  });

  test('modo alternado: o painel ocupa a área de trabalho e devolve a conversa', async () => {
    larguraDaJanela(600);
    comFila();
    const { container } = renderDashboard();
    const mesa = container.querySelector('[data-lista]');
    const lista = container.querySelector('aside');
    await abrirEspera();
    await userEvent.click(within(lista).getByRole('button', { name: 'Carlos' }));
    expect(mesa).toHaveAttribute('data-painel', 'coluna');

    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));

    // Não cabem trilho + conversa + painel: o painel deixa de ser coluna e
    // passa a alternar com a conversa, nunca por cima dela.
    expect(mesa).toHaveAttribute('data-painel', 'alternado');
    expect(mesa).toHaveAttribute('data-lista', 'rail');

    const voltar = screen.getByRole('button', { name: /voltar à conversa/i });
    await userEvent.click(voltar);

    expect(mesa).toHaveAttribute('data-painel', 'coluna');
    expect(screen.queryByRole('button', { name: /voltar à conversa/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();
  });

  test('modo estreito: uma coisa por vez, com volta para a lista', async () => {
    larguraDaJanela(500);
    comFila();
    const { container } = renderDashboard();
    const mesa = container.querySelector('[data-lista]');
    const lista = container.querySelector('aside');

    expect(mesa).toHaveAttribute('data-lista', 'oculta');
    // Sem conversa escolhida, quem ocupa a área de trabalho é a tela vazia.
    expect(screen.getByText('Net Fibra · Atendimento')).toBeInTheDocument();

    await abrirEspera();
    await userEvent.click(within(lista).getByRole('button', { name: /carlos/i }));

    // A conversa tomou o lugar da tela vazia: um contexto por vez.
    expect(screen.queryByText('Net Fibra · Atendimento')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transferir/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    expect(screen.queryByRole('button', { name: /transferir/i })).not.toBeInTheDocument();
    expect(screen.getByText('Net Fibra · Atendimento')).toBeInTheDocument();
    expect(mesa).toHaveAttribute('data-lista', 'oculta');
  });

  // Equivalente real: AppShell.test.jsx > 'a raiz usa h-dvh para a altura da viewport'.
  test.skip('uses the dynamic viewport height unit so mobile browser chrome cannot cover the composer', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { container } = renderDashboard();
    expect(container.firstChild.className).toContain('h-dvh');
  });

  // "Equipe" saiu do rodapé da lista e foi para o trilho da mesa:
  // SideNav.mesa.test.jsx > 'Equipe abre o popup "Nossa equipe"…'.
  test('a lista não tem mais a barra "Equipe" no rodapé', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(within(screen.getByRole('complementary', { name: 'Atendimentos' })).queryByRole('button', { name: /^equipe/i })).not.toBeInTheDocument();
  });

  test('em carregamento não mostra "Nenhum atendimento em andamento"', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'loading' });
    renderDashboard();
    expect(screen.queryByText(/nenhum atendimento em andamento/i)).not.toBeInTheDocument();
  });

  test('em carregamento não mostra "Nenhum atendimento em espera"', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'loading' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    expect(screen.queryByText(/nenhum atendimento em espera/i)).not.toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'mostra as iniciais da empresa e o botão de som'.
  test.skip('shows the sound toggle button reflecting the unmuted state', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'com o som mutado, o botão vira "Som desativado"'.
  test.skip('shows the sound toggle button reflecting the muted state', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    useQueueNotificationSound.mockReturnValue({ muted: true, toggleMuted: vi.fn() });
    renderDashboard();
    expect(screen.getByRole('button', { name: /som desativado/i })).toBeInTheDocument();
  });

  // Equivalente real: SideNav.test.jsx > 'clicar no botão de som chama toggleMuted'.
  test.skip('clicking the sound toggle button calls toggleMuted', async () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const toggleMuted = vi.fn();
    useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted });
    renderDashboard();

    await userEvent.click(screen.getByRole('button', { name: /som ativado/i }));

    expect(toggleMuted).toHaveBeenCalledTimes(1);
  });

  test('opens a conversation passed in via location.state.pendingConversation, even when not in queue or myConversations', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderInShell(<DashboardPage />, {
      initialEntries: [
        {
          pathname: '/',
          state: {
            pendingConversation: {
              id: 'conv-other-agent',
              contactDisplayName: 'Cliente de Outro Atendente',
              assignedAgentId: 'agent-2',
              status: 'assigned',
            },
          },
        },
      ],
    });
    expect(screen.getAllByText('Cliente de Outro Atendente').length).toBeGreaterThan(0);
  });
});

// Maria transfere para João: ele precisa perceber. O aviso aparece na tela de
// Atendimento e leva direto para a conversa recebida.
// Painel da lista na mesa (fatia 1 do novo atendimento): cabeçalho
// "Conversas" com a ação de nova conversa em ícone, busca integrada e os
// ícones da família DW nos elementos novos. As três abas continuam.
describe('painel de conversas da mesa', () => {
  const NA_ESPERA = { id: 'c-esp', contactDisplayName: 'Joana', contactPhoneNumber: '5598911112222', status: 'waiting', createdAt: '2026-09-24T13:05:00.000Z' };

  function lista() {
    return screen.getByRole('complementary', { name: 'Atendimentos' });
  }
  // Moldura da família DW (components/icones/Icone.jsx).
  function eDaFamiliaDw(svg) {
    return svg.getAttribute('viewBox') === '0 0 24 24' && svg.getAttribute('stroke-width') === '1.75' && svg.getAttribute('fill') === 'none';
  }

  beforeEach(() => {
    useQueue.mockReturnValue({ queue: [NA_ESPERA], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [{ id: 'c-minha', contactDisplayName: 'Maria', status: 'assigned', assignedAgentId: 'agent-1' }], status: 'ready' });
  });

  test('o título do painel é "Conversas"', () => {
    renderDashboard();
    expect(within(lista()).getByRole('heading', { level: 1, name: 'Conversas' })).toBeInTheDocument();
  });

  test('"Nova conversa" é um botão de ícone DW; o rótulo só na dica', () => {
    renderDashboard();
    const nova = within(lista()).getByRole('button', { name: 'Nova conversa' });
    // O único texto dentro do botão é a dica, fora da árvore de acessibilidade
    // (o nome vem do aria-label) e escondida até o ponteiro ou o foco.
    expect(within(nova).getByText('Nova conversa')).toHaveAttribute('aria-hidden', 'true');
    expect([...nova.children].filter((filho) => filho.getAttribute('aria-hidden') !== 'true')).toHaveLength(0);
    expect(eDaFamiliaDw(nova.querySelector('svg'))).toBe(true);
  });

  test('a busca fica no painel, com a lupa da família DW', () => {
    renderDashboard();
    const busca = within(lista()).getByRole('searchbox', { name: 'Buscar conversa' });
    expect(eDaFamiliaDw(busca.closest('label').querySelector('svg'))).toBe(true);
  });

  test('as três abas continuam: Atendimento, Espera e Automação, sem "Todas"', () => {
    renderDashboard();
    const abas = within(lista()).getAllByRole('tab').map((aba) => aba.textContent.replace(/\d+/g, '').trim());
    expect(abas).toEqual(['Atendimento', 'Espera', 'Automação']);
  });

  test('"Finalizar sem motivo" na Espera usa o ícone DW de encerrar', async () => {
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    const finalizar = within(lista()).getByRole('button', { name: 'Finalizar sem motivo' });
    expect(eDaFamiliaDw(finalizar.querySelector('svg'))).toBe(true);
  });

  // A casca reserva os encaixes; é a mesa que desenha o trilho e o ícone do
  // botão "Abrir menu" neles (AppShell.jsx).
  test('desenha o trilho e o ícone do menu nos encaixes que a casca oferece', () => {
    const encaixeDoTrilho = document.body.appendChild(document.createElement('div'));
    const encaixeDoIcone = document.body.appendChild(document.createElement('span'));
    try {
      renderInShell(<DashboardPage />, { context: { encaixeDoTrilho, encaixeDoIcone, mobileNavOpen: false } });
      const trilho = within(encaixeDoTrilho).getByRole('navigation', { name: 'Navegação principal' });
      expect(trilho).toHaveAttribute('data-variante', 'mesa');
      expect(within(trilho).getByRole('link', { name: 'Atendimento' })).toHaveAttribute('aria-current', 'page');
      expect(eDaFamiliaDw(encaixeDoIcone.querySelector('svg'))).toBe(true);
    } finally {
      encaixeDoTrilho.remove();
      encaixeDoIcone.remove();
    }
  });

  test('sem encaixe (fora da casca), a mesa não desenha trilho', () => {
    renderDashboard();
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument();
  });

  // Contagem é o tamanho de cada fila (não "não lidas"). Três dígitos têm de
  // aparecer inteiros; o que o jsdom não mede (caber em 332 px) é conferido no
  // navegador, com as capturas desta etapa.
  test.each([
    [9, 99, 999],
    [999, 9, 99],
    [99, 999, 9],
  ])('as abas mostram as contagens inteiras: Atendimento %i, Espera %i, Automação %i', (minhas, espera, automacao) => {
    const conversa = (id, extra = {}) => ({ id, contactDisplayName: `Cliente ${id}`, status: 'waiting', ...extra });
    useMyConversations.mockReturnValue({ conversations: Array.from({ length: minhas }, (_, i) => conversa(`m${i}`, { status: 'assigned', assignedAgentId: 'agent-1' })), status: 'ready' });
    useQueue.mockReturnValue({
      queue: [
        ...Array.from({ length: espera }, (_, i) => conversa(`e${i}`)),
        ...Array.from({ length: automacao }, (_, i) => conversa(`a${i}`, { triageState: 'pending' })),
      ],
      status: 'ready',
    });
    renderDashboard();
    const [atendimento, naEspera, naAutomacao] = within(lista()).getAllByRole('tab');
    expect(atendimento).toHaveTextContent(`Atendimento${minhas}`);
    expect(naEspera).toHaveTextContent(`Espera${espera}`);
    expect(naAutomacao).toHaveTextContent(`Automação${automacao}`);
  });

  test('no modo lista estreita, expandir e "Voltar à conversa" usam o ícone DW', async () => {
    larguraDaJanela(600);
    renderDashboard();
    await userEvent.click(within(lista()).getAllByRole('button', { name: 'Maria' })[0]);
    const expandir = screen.getByRole('button', { name: /ver lista de atendimentos/i });
    expect(eDaFamiliaDw(expandir.querySelector('svg'))).toBe(true);
    await userEvent.click(expandir);
    expect(eDaFamiliaDw(screen.getByRole('button', { name: /voltar à conversa/i }).querySelector('svg'))).toBe(true);
  });

  test('buscar filtra a lista e escolher abre a conversa', async () => {
    renderDashboard();
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar conversa' }), 'maria');
    expect(within(lista()).queryByRole('button', { name: /^Joana/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar conversa' }));
    await userEvent.click(within(lista()).getByRole('button', { name: /^Joana/ }));
    expect(within(lista()).getByRole('button', { name: /^Joana/ })).toHaveAttribute('aria-current', 'true');
    expect(within(screen.getByRole('main')).getAllByText('Joana').length).toBeGreaterThan(0);
  });
});

describe('aviso de transferência recebida', () => {
  const TRANSFERIDA ={ id: 'conv-t', contactPhoneNumber: '5511999998888', contactDisplayName: 'Carlos', assignedAgentId: 'agent-1', status: 'assigned' };

  test('não mostra nada quando ninguém transferiu', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    renderDashboard();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('mostra quem transferiu e de qual cliente', () => {
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [TRANSFERIDA], status: 'ready' });
    useTransferNotice.mockReturnValue({
      notice: { conversationId: 'conv-t', contactName: 'Carlos', byName: 'Maria Souza' },
      dismiss: vi.fn(),
    });
    renderDashboard();

    // O aviso fala por uma região viva sem role="status" (C5-6).
    const aviso = screen.getByRole('button', { name: /Abrir o atendimento de Carlos/ });
    expect(aviso).toHaveTextContent('Maria Souza');
    expect(aviso).toHaveTextContent('Carlos');
  });

  test('clicar no aviso abre a conversa transferida e dispensa o aviso', async () => {
    const dismiss = vi.fn();
    useQueue.mockReturnValue({ queue: [], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [TRANSFERIDA], status: 'ready' });
    useTransferNotice.mockReturnValue({
      notice: { conversationId: 'conv-t', contactName: 'Carlos', byName: 'Maria Souza' },
      dismiss,
    });
    renderDashboard();

    expect(screen.getByText('Net Fibra · Atendimento')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /abrir o atendimento/i }));

    expect(dismiss).toHaveBeenCalled();
    // A tela vazia deu lugar à conversa transferida.
    expect(screen.queryByText('Net Fibra · Atendimento')).not.toBeInTheDocument();
    expect(screen.getByTitle('5511999998888')).toHaveTextContent('Carlos');
  });
});

// A conversa aberta só redesenha com o que é dela (BUG-004, achado A2). Na
// mesa, só a ConversationView chama useQuickReplies, uma vez por render: as
// chamadas do mock contam os renders da conversa.
describe('fronteira da conversa aberta', () => {
  const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn() };
  const mesa = () => (
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  const rendersDaConversa = () => useQuickReplies.mock.calls.length;

  async function abrirNaEspera(nome) {
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    await userEvent.click(screen.getByText(nome));
  }

  test('mudança em outra conversa atualiza a lista sem redesenhar a conversa aberta', async () => {
    const aberta = { id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null };
    const outra = { id: 'c2', contactDisplayName: 'Bruna', status: 'waiting', assignedAgentId: null, lastMessageContent: 'primeira mensagem' };
    useQueue.mockReturnValue({ queue: [aberta, outra], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { rerender } = render(mesa());
    await abrirNaEspera('Carlos');
    expect(screen.getByRole('button', { name: 'Editar cliente: Carlos' })).toBeInTheDocument();
    expect(screen.getByText('primeira mensagem')).toBeInTheDocument();
    const antes = rendersDaConversa();

    // Como o useQueue responde a um evento de outra conversa: array novo, só o
    // item dela trocado, a conversa aberta com a mesma referência.
    useQueue.mockReturnValue({ queue: [aberta, { ...outra, lastMessageContent: 'segunda mensagem' }], status: 'ready' });
    rerender(mesa());

    expect(screen.getByText('segunda mensagem')).toBeInTheDocument();
    expect(rendersDaConversa()).toBe(antes);
  });

  test('objeto novo da conversa aberta redesenha a conversa e mostra o dado novo', async () => {
    const aberta = { id: 'c1', contactDisplayName: 'Carlos', status: 'waiting', assignedAgentId: null };
    useQueue.mockReturnValue({ queue: [aberta], status: 'ready' });
    useMyConversations.mockReturnValue({ conversations: [], status: 'ready' });
    const { rerender } = render(mesa());
    await abrirNaEspera('Carlos');
    expect(screen.getByRole('button', { name: 'Editar cliente: Carlos' })).toBeInTheDocument();
    const antes = rendersDaConversa();

    useQueue.mockReturnValue({ queue: [{ ...aberta, contactDisplayName: 'Carlos Pereira' }], status: 'ready' });
    rerender(mesa());

    expect(rendersDaConversa()).toBeGreaterThan(antes);
    expect(screen.getByRole('button', { name: 'Editar cliente: Carlos Pereira' })).toBeInTheDocument();
  });
});

// "Editar cliente" na mesa, com os hooks de lista DE VERDADE (só a API é
// simulada). A rota de edição não emite evento: sem a página levar o que foi
// salvo até as listas, voltar à lista e reabrir a conversa trazia de volta a
// nota antiga — e salvar de novo a devolvia ao servidor.
describe('edição do contato na mesa: a lista guarda o que foi salvo', () => {
  let filaReal;
  let meusReais;
  beforeAll(async () => {
    filaReal = await vi.importActual('../hooks/useQueue');
    meusReais = await vi.importActual('../hooks/useMyConversations');
  });

  const A = { id: 'conv-A', contactId: 'contato-A', contactDisplayName: 'Contato A', contactInternalNote: 'Nota antiga', status: 'assigned', assignedAgentId: 'agent-1' };
  const B = { id: 'conv-B', contactId: 'contato-B', contactDisplayName: 'Contato B', contactInternalNote: 'Nota de B', status: 'assigned', assignedAgentId: 'agent-1' };

  beforeEach(() => {
    useQueue.mockImplementation(filaReal.useQueue);
    useMyConversations.mockImplementation(meusReais.useMyConversations);
    getQueue.mockResolvedValue([]);
    getMyConversations.mockResolvedValue([A, B]);
    listCities.mockResolvedValue([]);
    // clearAllMocks não esvazia a fila de mockReturnValueOnce.
    updateContact.mockReset();
  });

  const lista = () => screen.getByRole('complementary', { name: 'Atendimentos' });
  const linha = (nome) => within(lista()).getByRole('button', { name: new RegExp(`^${nome}`) });
  const edicao = () => screen.getByRole('dialog', { name: 'Editar cliente' });
  const painel = () => screen.getByRole('complementary', { name: 'Dados do cliente' });
  const rendersDaConversa = () => useQuickReplies.mock.calls.length;

  // Abre a conversa e o painel "Dados do cliente" (que só existe aberto).
  async function abrir(nome) {
    await userEvent.click(await within(lista()).findByRole('button', { name: new RegExp(`^${nome}`) }));
    await screen.findByRole('button', { name: new RegExp(`^Editar cliente: ${nome}`) });
    await userEvent.click(screen.getByRole('button', { name: 'Dados do cliente' }));
  }
  async function editar(nome, campos) {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^Editar cliente: ${nome}`) }));
    // O modal de edição chega sob demanda.
    await screen.findByRole('dialog', { name: 'Editar cliente' });
    for (const [rotulo, texto] of campos) {
      const campo = within(edicao()).getByLabelText(rotulo);
      await userEvent.clear(campo);
      await userEvent.type(campo, texto);
    }
    await userEvent.click(within(edicao()).getByRole('button', { name: 'Salvar alterações' }));
  }
  const edicaoFechou = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());

  test('salvar, voltar à lista e reabrir: a conversa volta com a nota nova', async () => {
    updateContact.mockResolvedValue({ id: 'contato-A', displayName: 'Contato A', cityId: null, localityId: null, internalNote: 'Nota nova' });
    renderDashboard();
    await abrir('Contato A');
    await editar('Contato A', [['Nota interna', 'Nota nova']]);
    await edicaoFechou();

    // Voltar à lista desmonta a conversa: o que ela guardava some junto.
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a lista' }));
    expect(screen.queryByRole('button', { name: /^Editar cliente:/ })).not.toBeInTheDocument();

    await abrir('Contato A');
    expect(within(painel()).getByText('Nota nova')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Editar cliente: Contato A/ }));
    expect(within(await screen.findByRole('dialog', { name: 'Editar cliente' })).getByLabelText('Nota interna')).toHaveValue('Nota nova');
  });

  test('salvar na mesa troca o nome na linha da lista', async () => {
    updateContact.mockResolvedValue({ id: 'contato-A', displayName: 'Contato A editado', cityId: null, localityId: null, internalNote: 'Nota antiga' });
    renderDashboard();
    await abrir('Contato A');
    await editar('Contato A', [['Nome', 'Contato A editado']]);
    await edicaoFechou();

    expect(linha('Contato A editado')).toBeInTheDocument();
    expect(linha('Contato B')).toBeInTheDocument();
  });

  test('resposta atrasada de A com B aberta: a linha de A muda, e B não muda nem redesenha', async () => {
    let responderA;
    updateContact.mockReturnValueOnce(new Promise((resolve) => { responderA = resolve; }));
    renderDashboard();
    await abrir('Contato A');
    await editar('Contato A', [['Nome', 'Contato A editado']]);
    // Salvando, o Esc não abandona a edição pela metade.
    await userEvent.keyboard('{Escape}');
    expect(edicao()).toBeInTheDocument();
    // A conversa troca por baixo do modal com o "Salvar" no caminho. No
    // navegador o fundo cobre a lista e isso só vem de causa externa; aqui o
    // clique na linha faz a vez dela.
    await abrir('Contato B');
    await edicaoFechou();
    const antes = rendersDaConversa();

    await act(async () => {
      responderA({ id: 'contato-A', displayName: 'Contato A editado', cityId: null, localityId: null, internalNote: 'Nota de A editada' });
    });

    expect(linha('Contato A editado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar cliente: Contato B' })).toBeInTheDocument();
    expect(within(painel()).getByText('Nota de B')).toBeInTheDocument();
    expect(within(painel()).queryByText('Nota de A editada')).not.toBeInTheDocument();
    expect(rendersDaConversa()).toBe(antes);
  });
});
