import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from '../pages/SupervisionPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardClosedToday, getPublicCompany } from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';

// Guarda do carregamento sob demanda da Supervisão (auditoria de 27/09).
//
// A página importava a conversa inteira (ConversationView, 100,8 kB brutos,
// 81% sem uso ao abrir) e o TransferModal de forma estática: quem só olhava a
// fila baixava e avaliava tudo isso. Agora o popup e a transferência chegam
// quando são abertos. Duas provas, como em mesaSobDemanda.test.jsx:
//  1. LEITURA: a página e o que ela importa não trazem esses módulos por
//     import estático;
//  2. EFEITO: montar a página não avalia os módulos; abrir a conversa avalia.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
function importsEstaticos(relativo) {
  const fonte = readFileSync(join(RAIZ, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...fonte.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
const PESADOS = /ClosedConversationsModal|ConversationView|TransferModal|PopupDaSupervisao|ConversaDaSupervisao|popup-da-supervisao/;

const avaliados = vi.hoisted(() => new Set());
// O antigo modal de conversa saiu (28/09): a conversa dos Encerrados mora no
// diálogo deles. O popup da Supervisão não passa por esse módulo.
vi.mock('../components/ClosedConversationsModal', async (original) => {
  avaliados.add('ClosedConversationsModal');
  return original();
});
vi.mock('../components/ConversationView', async (original) => {
  avaliados.add('ConversationView');
  return original();
});
vi.mock('../components/TransferModal', async (original) => {
  avaliados.add('TransferModal');
  return original();
});
vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'agent-9', role: 'admin' } });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Atendente A', online: true }], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  getPublicCompany.mockResolvedValue({ name: '' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useAttendanceDashboard.mockReturnValue({
    inProgress: [{ id: 'c1', contactId: 'ct1', contactDisplayName: 'Cliente 101', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'x', createdAt: new Date().toISOString() }],
    waiting: [], inAutomation: [], closedTodayCount: 0, status: 'ready', loading: false, refresh: vi.fn(), aplicarContatoSalvo: vi.fn(),
  });
});

describe('Supervisão: a conversa e a transferência chegam sob demanda', () => {
  test.each([
    'pages/SupervisionPage.jsx',
    'components/supervisao/ListaDaSupervisao.jsx',
    'components/supervisao/LinhaDaSupervisao.jsx',
    'components/supervisao/EquipeDaSupervisao.jsx',
    'components/supervisao/FiltrosDaSupervisao.jsx',
    'components/supervisao/EncerradosDaSupervisao.jsx',
    'components/supervisao/IndicadoresDaSupervisao.jsx',
    'components/supervisao/Relogio.jsx',
    'components/supervisao/regras.js',
  ])(
    '%s não importa a conversa nem a transferência de forma estática',
    (arquivo) => {
      expect(importsEstaticos(arquivo).filter((origem) => PESADOS.test(origem))).toEqual([]);
    }
  );

  test('abrir a página não avalia a conversa; abrir a linha avalia; transferir avalia a transferência', async () => {
    const user = userEvent.setup();
    renderInShell(<SupervisionPage />, { path: '/supervisao' });
    expect(screen.getByRole('heading', { level: 1, name: 'Supervisão' })).toBeInTheDocument();
    expect([...avaliados]).toEqual([]);

    const lista = screen.getByRole('region', { name: /^Conversas/ });
    await user.click(within(lista).getByRole('button', { name: /Cliente 101/ }));
    await screen.findByRole('dialog', { name: /^Conversa com/ });
    // O popup não passa pelo diálogo dos Encerrados.
    expect(avaliados.has('ClosedConversationsModal')).toBe(false);
    expect(avaliados.has('ConversationView')).toBe(true);
    expect(avaliados.has('TransferModal')).toBe(false);

    await user.click(screen.getByRole('button', { name: /transferir atendimento/i }));
    expect(await screen.findByRole('heading', { name: 'Transferir atendimento' })).toBeInTheDocument();
    expect(avaliados.has('TransferModal')).toBe(true);
  });
});
