import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DashboardPage from '../pages/DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useSocket, useSocketConnection } from '../contexts/SocketContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

// O trecho de um dos cinco diálogos do Bloco 1 não baixou (rede caiu no meio
// do turno). A mesa continua de pé, com a conversa aberta; quem abriu avisa
// em português, e o botão continua funcionando — o clique seguinte tenta de
// novo (utils/sobDemanda.test.jsx prova que a nova tentativa baixa de verdade).
const FALHA = vi.hoisted(() => () => { throw new Error('falha simulada ao baixar o trecho'); });
vi.mock('../components/ProfileModal', FALHA);
vi.mock('../components/TeamModal', FALHA);
vi.mock('../components/StartConversationModal', FALHA);
vi.mock('../components/SendTemplateModal', FALHA);
vi.mock('../components/ClosedConversationsModal', FALHA);
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getAiSuggestion: vi.fn(() => new Promise(() => {})),
  listCities: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [], status: 'ready', refresh: () => {} }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set() }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');

const DOIS_DIAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const CONVERSA = { id: 'c2', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'ch-1', channelType: 'meta_cloud' };

let retangulos;
beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Atendente A', role: 'agent' }, logout: vi.fn(), updateAgent: vi.fn() });
  useSocket.mockReturnValue(null);
  useSocketConnection.mockReturnValue('connected');
  useQueue.mockReturnValue({ queue: [], status: 'ready' });
  useMyConversations.mockReturnValue({ conversations: [CONVERSA], status: 'ready' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [{ id: 'm1', direction: 'inbound', content: 'Oi', createdAt: DOIS_DIAS }], status: 'ready', sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Provedor Exemplo', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
  retangulos = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => retangulos.mockRestore());

async function montarComConversa(user) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  await user.click(await screen.findByText('Cliente 101'));
  await screen.findByRole('button', { name: 'Enviar template' });
}

const CASOS = [
  ['Enviar template', () => screen.getByRole('button', { name: 'Enviar template' }), 'Não foi possível abrir o envio de template.'],
  ['Nossa equipe', () => screen.getByRole('button', { name: /^Equipe/ }), 'Não foi possível abrir a equipe.'],
  ['Nova conversa', () => screen.getByRole('button', { name: 'Nova conversa' }), 'Não foi possível abrir a nova conversa.'],
  ['Atendimentos encerrados', () => screen.getByRole('button', { name: 'Atendimentos encerrados' }), 'Não foi possível abrir os atendimentos encerrados.'],
];

describe('Bloco 1: o trecho do diálogo não baixou', () => {
  test.each(CASOS)('%s: avisa, a mesa fica, e o clique seguinte tenta de novo', async (_nome, gatilho, frase) => {
    const user = userEvent.setup();
    await montarComConversa(user);
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      await user.click(gatilho());
      const aviso = await screen.findByRole('alertdialog');
      expect(aviso).toHaveTextContent(frase);
      expect(aviso.querySelector('[data-tom]')).toHaveAttribute('data-tom', 'erro');
      await user.click(screen.getByRole('button', { name: 'Entendi' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      // A conversa continua aberta.
      expect(screen.getByRole('button', { name: 'Enviar template' })).toBeInTheDocument();
    }
  });

  test('Meu perfil: a casca avisa e a mesa fica', async () => {
    const user = userEvent.setup();
    await montarComConversa(user);
    await user.click(screen.getByRole('button', { name: /^Conta: / }));
    await user.click(screen.getByRole('button', { name: 'Meu perfil' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Não foi possível abrir o Meu perfil.');
    await user.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.getByRole('button', { name: 'Enviar template' })).toBeInTheDocument();
  });
});
