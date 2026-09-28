import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import DashboardPage from '../pages/DashboardPage';
import { useAuth } from '../contexts/AuthContext';
import { useQueue } from '../hooks/useQueue';
import { useMyConversations } from '../hooks/useMyConversations';
import { useChannels } from '../hooks/useChannels';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useUnreadMyConversations } from '../hooks/useUnreadMyConversations';
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';
import { useReasons } from '../hooks/useReasons';

// Guarda dos diálogos Transferir e Encerrar sob demanda (27/09).
//
// Na mesa, o Transferir vinha no trecho da página e o Encerrar no da conversa
// — com os ícones antigos do catálogo dos motivos. Agora cada um chega quando
// é aberto, e o módulo dos desenhos dos motivos vem só com o Encerrar. Duas
// provas, como em mesaSobDemanda.test.jsx:
//  1. LEITURA: ninguém importa os dois diálogos de forma estática (só testes);
//     a mesa e a conversa os pedem por import dinâmico;
//  2. EFEITO: montar a mesa e abrir a conversa não avalia nenhum dos dois nem
//     os motivos; Transferir traz só o Transferir; Encerrar traz o Encerrar e
//     os motivos.

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

const avaliados = vi.hoisted(() => new Set());
vi.mock('../components/TransferModal', async (original) => {
  avaliados.add('TransferModal');
  return original();
});
vi.mock('../components/CloseReasonModal', async (original) => {
  avaliados.add('CloseReasonModal');
  return original();
});
vi.mock('../components/icones/motivos', async (original) => {
  avaliados.add('motivos');
  return original();
});
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
  listCities: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../contexts/AuthContext');
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
vi.mock('../hooks/useReasons');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useQueue.mockReturnValue({ queue: [], status: 'ready' });
  useMyConversations.mockReturnValue({ conversations: [{ id: 'c2', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: 'agent-1' }], status: 'ready' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn(), appendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Provedor Exemplo', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
  useReasons.mockReturnValue({ reasons: [{ id: 'r1', name: 'Mudança de plano', active: true }], status: 'ready', loading: false, refresh: vi.fn() });
});

describe('Transferir e Encerrar: leitura dos imports', () => {
  test('nenhum arquivo do app importa os dois diálogos de forma estática', () => {
    const estaticos = arquivosDoApp()
      .filter((caminho) => importsEstaticos(caminho).some((o) => /(^|\/)(TransferModal|CloseReasonModal)$/.test(o)))
      .map((caminho) => relative(RAIZ, caminho).replace(/\\/g, '/'));
    expect(estaticos).toEqual([]);
  });

  test('a mesa pede o Transferir, e a conversa (mesa e Supervisão) pede o Encerrar, por import dinâmico', () => {
    expect(importsDinamicos(join(RAIZ, 'pages/DashboardPage.jsx'))).toContain('../components/TransferModal');
    expect(importsDinamicos(join(RAIZ, 'components/ConversationView.jsx'))).toContain('./CloseReasonModal');
    expect(importsDinamicos(join(RAIZ, 'pages/SupervisionPage.jsx'))).toContain('../components/TransferModal');
  });

  test('o módulo dos motivos só entra pelo Encerrar, e o Transferir não leva nada dele', () => {
    expect(importsEstaticos(join(RAIZ, 'components/CloseReasonModal.jsx'))).toContain('./icones/motivos');
    expect(importsEstaticos(join(RAIZ, 'components/TransferModal.jsx')).filter((o) => /motivos/.test(o))).toEqual([]);
  });
});

describe('Transferir e Encerrar: efeito na mesa', () => {
  test('a mesa e a conversa abrem sem os diálogos; cada um chega quando é aberto, fecha e devolve o foco', async () => {
    const user = userEvent.setup();
    renderInShell(<DashboardPage />);
    await user.click(screen.getByText('Cliente 101'));
    const transferir = await screen.findByRole('button', { name: 'Transferir atendimento' });
    expect([...avaliados]).toEqual([]);

    await user.click(transferir);
    expect(await screen.findByRole('dialog', { name: 'Transferir atendimento' })).toBeInTheDocument();
    expect(avaliados.has('TransferModal')).toBe(true);
    expect(avaliados.has('CloseReasonModal')).toBe(false);
    expect(avaliados.has('motivos')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog', { name: 'Transferir atendimento' })).not.toBeInTheDocument();
    expect(transferir).toHaveFocus();

    const encerrar = screen.getByRole('button', { name: 'Encerrar atendimento' });
    await user.click(encerrar);
    const dialogo = await screen.findByRole('dialog', { name: 'Encerrar atendimento' });
    expect(avaliados.has('CloseReasonModal')).toBe(true);
    expect(avaliados.has('motivos')).toBe(true);
    expect(dialogo).toHaveTextContent('Mudança de plano');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Encerrar atendimento' })).not.toBeInTheDocument());
    expect(encerrar).toHaveFocus();
  });
});
