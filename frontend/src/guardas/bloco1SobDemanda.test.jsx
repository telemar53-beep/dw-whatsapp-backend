import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { render, screen, within, waitFor } from '@testing-library/react';
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
import { getMyProfile, listChannelsForAgent, listTemplatesForChannel, getMyClosedConversations } from '../services/api';

// Guarda do Bloco 1 (28/09): os cinco diálogos do dia a dia chegam quando são
// abertos, e fechados não custam nada. Duas provas, como nas outras guardas:
//  1. LEITURA: ninguém importa os cinco de forma estática (só testes), e cada
//     um é pedido por import dinâmico por quem o abre, pelo carregador
//     aprovado (utils/sobDemanda.js) — sem uma terceira implementação;
//  2. EFEITO: a casca e a mesa abertas, com uma conversa aberta, não avaliam
//     nenhum dos cinco nem fazem as requisições deles; cada clique traz só o
//     seu diálogo e só as requisições dele.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
function fonteSemComentario(caminho) {
  return readFileSync(caminho, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function importsEstaticos(caminho) {
  return [...fonteSemComentario(caminho).matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
function importsDinamicos(caminho) {
  return [...fonteSemComentario(caminho).matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}
function arquivosDoApp(pasta = RAIZ) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return arquivosDoApp(caminho);
    return /\.(js|jsx)$/.test(nome) && !/\.test\./.test(nome) ? [caminho] : [];
  });
}

const CINCO = /(^|\/)(ProfileModal|TeamModal|StartConversationModal|SendTemplateModal|ClosedConversationsModal)$/;

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/ProfileModal', async (original) => { avaliados.add('ProfileModal'); return original(); });
vi.mock('../components/TeamModal', async (original) => { avaliados.add('TeamModal'); return original(); });
vi.mock('../components/StartConversationModal', async (original) => { avaliados.add('StartConversationModal'); return original(); });
vi.mock('../components/SendTemplateModal', async (original) => { avaliados.add('SendTemplateModal'); return original(); });
vi.mock('../components/ClosedConversationsModal', async (original) => { avaliados.add('ClosedConversationsModal'); return original(); });
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getMyProfile: vi.fn(() => new Promise(() => {})),
  listChannelsForAgent: vi.fn(() => new Promise(() => {})),
  listTemplatesForChannel: vi.fn(() => new Promise(() => {})),
  getMyClosedConversations: vi.fn(() => new Promise(() => {})),
  getAiSuggestion: vi.fn(() => new Promise(() => {})),
  listCities: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../contexts/AuthContext');
vi.mock('../contexts/SocketContext');
vi.mock('../hooks/useQueue');
vi.mock('../hooks/useMyConversations');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents', () => ({ useAgents: () => ({ agents: [{ id: 'agent-1', name: 'Atendente A' }], status: 'ready', refresh: () => {} }) }));
vi.mock('../hooks/usePresence', () => ({ usePresence: () => new Set(['agent-1']) }));
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useUnreadMyConversations');
vi.mock('../hooks/useCompanyName');
vi.mock('../hooks/useTransferNotice');

// Conversa fictícia de canal oficial, com a última mensagem do cliente há dois
// dias: a janela de 24 h está fechada e o "Enviar template" aparece.
const DOIS_DIAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const CONVERSA = { id: 'c2', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'ch-1', channelType: 'meta_cloud' };

let retangulos;
beforeEach(() => {
  avaliados.clear();
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
  // O jsdom não mede: sem isto nada contaria como visível para o foco do trilho.
  retangulos = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => retangulos.mockRestore());

function montarMesa() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Bloco 1: leitura dos imports', () => {
  test('nenhum arquivo do app importa os cinco diálogos de forma estática', () => {
    const estaticos = arquivosDoApp()
      .filter((caminho) => importsEstaticos(caminho).some((origem) => CINCO.test(origem)))
      .map((caminho) => relative(RAIZ, caminho).replace(/\\/g, '/'));
    expect(estaticos).toEqual([]);
  });

  test.each([
    ['components/AppShell.jsx', './ProfileModal'],
    ['components/TeamPanel.jsx', './TeamModal'],
    ['pages/DashboardPage.jsx', '../components/StartConversationModal'],
    ['components/ConversationView.jsx', './SendTemplateModal'],
    ['components/TrilhoDaMesa.jsx', './ClosedConversationsModal'],
    ['components/SideNav.jsx', './ClosedConversationsModal'],
  ])('%s pede %s pelo carregador aprovado', (arquivo, modulo) => {
    const caminho = join(RAIZ, arquivo);
    expect(importsDinamicos(caminho)).toContain(modulo);
    const fonte = fonteSemComentario(caminho);
    const escapado = modulo.replace(/[./]/g, '\\$&');
    expect(fonte).toMatch(new RegExp(`sobDemanda\\(\\(\\) => import\\('${escapado}'\\)\\)`));
    expect(fonte).not.toMatch(new RegExp(`lazy\\(\\(\\) => import\\('${escapado}'\\)\\)`));
  });

  // Quem importa o barril ui/index.js leva o CSS importado por qualquer módulo
  // dele (efeito colateral): a folha clara entraria no CSS de entrada, que o
  // Login também baixa. Ela vem com os hooks e com a moldura clara.
  test('nenhum módulo do barril ui/index.js importa a folha clara', () => {
    const barril = fonteSemComentario(join(RAIZ, 'components/ui/index.js'));
    const modulos = [...barril.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);
    expect(modulos).toEqual(expect.arrayContaining(['ConfirmDialog', 'AlertDialog']));
    for (const modulo of modulos) {
      const caminho = ['.jsx', '.js'].map((ext) => join(RAIZ, 'components/ui', modulo + ext)).find((c) => { try { return statSync(c).isFile(); } catch { return false; } });
      expect(importsEstaticos(caminho).filter((origem) => /dialogo-claro\.css/.test(origem))).toEqual([]);
    }
    // Leitura direta: o extrator acima engole um `import 'x.css'` seguido de
    // outro import com `from`.
    for (const hook of ['hooks/useConfirm.jsx', 'hooks/useAlert.jsx']) {
      expect(fonteSemComentario(join(RAIZ, hook))).toMatch(/^import '\.\.\/components\/ui\/dialogo-claro\.css';/m);
    }
    for (const componente of ['components/ui/ConfirmDialog.jsx', 'components/ui/AlertDialog.jsx']) {
      expect(fonteSemComentario(join(RAIZ, componente))).not.toMatch(/\.css['"]/);
    }
  });

  test('a base clara não traz ícone da família antiga', () => {
    for (const arquivo of ['components/ui/ConfirmDialog.jsx', 'components/ui/AlertDialog.jsx', 'components/ui/DialogoClaro.jsx',
      'components/TeamModal.jsx', 'components/ProfileModal.jsx', 'components/StartConversationModal.jsx',
      'components/SendTemplateModal.jsx', 'components/ClosedConversationsModal.jsx', 'components/ClosedConversationsList.jsx',
      'components/AvisoDeConexao.jsx']) {
      expect(importsEstaticos(join(RAIZ, arquivo)).filter((origem) => /WaIcons/.test(origem))).toEqual([]);
    }
  });
});

describe('Bloco 1: efeito na casca e na mesa', () => {
  test('fechados, os cinco não chegam nem pedem nada; cada clique traz só o seu', async () => {
    const user = userEvent.setup();
    montarMesa();
    await user.click(await screen.findByText('Cliente 101'));
    const enviarTemplate = await screen.findByRole('button', { name: 'Enviar template' });

    // Mesa, casca, trilho e conversa abertos: nada dos cinco.
    expect([...avaliados]).toEqual([]);
    for (const pedido of [getMyProfile, listChannelsForAgent, listTemplatesForChannel, getMyClosedConversations]) {
      expect(pedido).not.toHaveBeenCalled();
    }

    const abrirEFechar = async (gatilho, nome, modulo, pedido) => {
      await user.click(gatilho());
      const dialogo = await screen.findByRole('dialog', { name: nome });
      expect(avaliados.has(modulo)).toBe(true);
      if (pedido) expect(pedido).toHaveBeenCalledTimes(1);
      await user.click(within(dialogo).getByRole('button', { name: 'Fechar' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: nome })).not.toBeInTheDocument());
    };

    await abrirEFechar(() => enviarTemplate, 'Enviar template', 'SendTemplateModal', listTemplatesForChannel);
    expect([...avaliados]).toEqual(['SendTemplateModal']);

    await abrirEFechar(() => screen.getByRole('button', { name: /^Equipe/ }), 'Nossa equipe', 'TeamModal');
    expect(avaliados.size).toBe(2);

    await abrirEFechar(() => screen.getByRole('button', { name: 'Nova conversa' }), 'Nova conversa', 'StartConversationModal', listChannelsForAgent);
    expect(avaliados.size).toBe(3);

    await user.click(screen.getByRole('button', { name: /^Conta: / }));
    await abrirEFechar(() => screen.getByRole('button', { name: 'Meu perfil' }), 'Meu perfil', 'ProfileModal', getMyProfile);
    expect(avaliados.size).toBe(4);

    await abrirEFechar(() => screen.getByRole('button', { name: 'Atendimentos encerrados' }), /Atendimentos encerrados/, 'ClosedConversationsModal', getMyClosedConversations);
    expect(avaliados.size).toBe(5);

    // Fechados de novo: nenhum pedido a mais de nenhum deles.
    for (const pedido of [getMyProfile, listChannelsForAgent, listTemplatesForChannel, getMyClosedConversations]) {
      expect(pedido).toHaveBeenCalledTimes(1);
    }
    // A conversa continua aberta na mesa depois de tudo isso.
    expect(screen.getByRole('button', { name: 'Enviar template' })).toBeInTheDocument();
  });
});
