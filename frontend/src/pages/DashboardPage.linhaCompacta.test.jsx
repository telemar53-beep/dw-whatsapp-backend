import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { useCompanyName } from '../hooks/useCompanyName';
import { useTransferNotice } from '../hooks/useTransferNotice';

// O QUE a linha compacta da mesa de atendimento informa — a lista real das
// abas Atendimento, Espera e Automação.
//
// Escrito ANTES do redesenho da linha, para fixar a informação que ele precisa
// preservar. Tudo é lido pelo nome acessível, por texto e por role; nada por
// classe, nem pela quantidade de linhas visuais (o redesenho passa a linha
// para 2 linhas).
//
// Legenda:
//   [FICA]  o redesenho precisa manter esta asserção passando como está.
//   [MUDA]  o redesenho muda isto DE PROPÓSITO; o comentário diz para quê.

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  closeConversation: vi.fn(),
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

const ULTIMA = '2026-09-24T15:42:00.000Z';
const CHEGADA = '2026-09-24T13:05:00.000Z';

// Mesma formatação do componente: o teste não depende do fuso da máquina.
function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const BASE = {
  contactPhoneNumber: '+5598988887777',
  contactCityName: 'Cândido Mendes',
  contactLocalityName: 'Barão de Tromaí',
  sectorName: 'Financeiro',
  lastMessageContent: 'Minha internet caiu de novo',
  lastMessageDirection: 'inbound',
  lastMessageAt: ULTIMA,
  createdAt: CHEGADA,
};

const MINHA = {
  ...BASE,
  id: 'c-minha',
  contactId: 'k-minha',
  contactDisplayName: 'Raimunda Nonata',
  status: 'assigned',
  assignedAgentId: 'agent-1',
  assignedAgentName: 'Ana Souza',
  aiTriageCompletedAt: '2026-09-24T13:06:00.000Z',
  aiTriageReasonName: 'Sem conexão',
  aiTriageLowConfidence: true,
};

const NA_ESPERA = {
  ...BASE,
  id: 'c-espera',
  contactId: 'k-espera',
  contactDisplayName: 'Joaquim Pereira',
  status: 'waiting',
  assignedAgentId: null,
  aiTriageCompletedAt: '2026-09-24T13:06:00.000Z',
  aiTriageReasonName: 'Segunda via',
  aiTriageResolvedByAi: true,
};

const EM_AUTOMACAO = {
  ...BASE,
  id: 'c-automacao',
  contactId: 'k-automacao',
  contactDisplayName: 'Francisca Lima',
  status: 'waiting',
  assignedAgentId: null,
  triageState: 'pending',
  sectorName: null,
};

const LARGURA_PADRAO = window.innerWidth;
function larguraDaJanela(px) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Janela larga: a lista expandida (variante compact), e não o rail.
  larguraDaJanela(1600);
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' }, logout: vi.fn() });
  useQueue.mockReturnValue({ queue: [NA_ESPERA, EM_AUTOMACAO], status: 'ready' });
  useMyConversations.mockReturnValue({ conversations: [MINHA], status: 'ready' });
  useChannels.mockReturnValue({ channels: [], loading: false, refresh: vi.fn() });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useUnreadMyConversations.mockReturnValue({ unreadIds: new Set(['c-minha', 'c-espera']), clearUnread: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'Net Fibra', status: 'ready' });
  useTransferNotice.mockReturnValue({ notice: null, dismiss: vi.fn() });
});
afterEach(() => larguraDaJanela(LARGURA_PADRAO));

// A linha é o elemento que abre a conversa; o <li> em volta dela é o que
// também guarda o "Finalizar sem motivo". Os dois achados por role.
function linhaDe(nome) {
  return screen.getByRole('button', { name: new RegExp(`^${nome}`) });
}
function itemDe(linha) {
  return screen.getAllByRole('listitem').filter((li) => li.contains(linha)).pop();
}

describe('linha compacta — aba Atendimento (meus atendimentos)', () => {
  test('[FICA] nome, hora da última mensagem e prévia', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(within(linha).getByText('Raimunda Nonata')).toBeInTheDocument();
    expect(within(linha).getByText(hora(ULTIMA))).toBeInTheDocument();
    expect(within(linha).queryByText(hora(CHEGADA))).not.toBeInTheDocument();
    expect(within(linha).getByText('Minha internet caiu de novo')).toBeInTheDocument();
  });

  test('[FICA] mensagem não lida é anunciada no nome da linha', () => {
    renderInShell(<DashboardPage />);
    expect(linhaDe('Raimunda Nonata')).toHaveAccessibleName(/Mensagem não lida/);
  });

  // O redesenho tira cidade e setor da VISTA nesta aba — mas quem usa leitor
  // de tela continua precisando deles para distinguir dois clientes.
  test('[FICA] localidade · município e setor continuam no nome acessível da linha', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(linha).toHaveAccessibleName(/Barão de Tromaí · Cândido Mendes/);
    expect(linha).toHaveAccessibleName(/Financeiro/);
  });

  // [MUDA] Hoje são chips visíveis. No redesenho saem da vista nesta aba: esta
  // asserção é a que sai (ou vira "não aparece como texto visível"), e a de
  // cima, do nome acessível, é a que segura a informação.
  test('[MUDA] hoje localidade · município e setor aparecem como texto na linha', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(within(linha).getByText('Barão de Tromaí · Cândido Mendes')).toBeInTheDocument();
    expect(within(linha).getByText('Financeiro')).toBeInTheDocument();
  });

  // [MUDA] Nesta aba todas as conversas são do próprio atendente: o chip com o
  // nome dele não informa nada. No redesenho vira
  // `expect(within(linha).queryByText('Ana Souza')).not.toBeInTheDocument()`.
  test('[MUDA] hoje o nome do próprio responsável aparece como chip', () => {
    renderInShell(<DashboardPage />);
    expect(within(linhaDe('Raimunda Nonata')).getByText('Ana Souza')).toBeInTheDocument();
  });

  test('[FICA] estado da IA: "IA · motivo" e o ⚠ de confiança baixa com nome acessível', () => {
    renderInShell(<DashboardPage />);
    const linha = linhaDe('Raimunda Nonata');

    expect(within(linha).getByText('IA · Sem conexão')).toBeInTheDocument();
    const alerta = within(linha).getByLabelText('Triagem com confiança baixa');
    expect(alerta).toHaveTextContent('⚠');
    expect(linha).toHaveAccessibleName(/Triagem com confiança baixa/);
  });

  test('[FICA] sem "Finalizar sem motivo" na aba Atendimento', () => {
    renderInShell(<DashboardPage />);
    expect(screen.queryByRole('button', { name: 'Finalizar sem motivo' })).not.toBeInTheDocument();
  });
});

describe('linha compacta — aba Espera', () => {
  async function abrirEspera() {
    renderInShell(<DashboardPage />);
    await userEvent.click(screen.getByRole('tab', { name: /espera/i }));
    return linhaDe('Joaquim Pereira');
  }

  test('[FICA] nome, hora de CHEGADA (não a da última mensagem) e prévia', async () => {
    const linha = await abrirEspera();

    expect(within(linha).getByText('Joaquim Pereira')).toBeInTheDocument();
    expect(within(linha).getByText(hora(CHEGADA))).toBeInTheDocument();
    expect(within(linha).queryByText(hora(ULTIMA))).not.toBeInTheDocument();
    expect(within(linha).getByText('Minha internet caiu de novo')).toBeInTheDocument();
  });

  test('[FICA] só a localidade, sem o município; setor e não lida no nome da linha', async () => {
    const linha = await abrirEspera();

    expect(within(linha).getByText('Barão de Tromaí')).toBeInTheDocument();
    expect(linha).not.toHaveAccessibleName(/Cândido Mendes/);
    expect(linha).toHaveAccessibleName(/Financeiro/);
    expect(linha).toHaveAccessibleName(/Mensagem não lida/);
  });

  test('[FICA] "IA · motivo" e "Resolvido pela IA"', async () => {
    const linha = await abrirEspera();

    expect(within(linha).getByText('IA · Segunda via')).toBeInTheDocument();
    expect(within(linha).getByText('Resolvido pela IA')).toBeInTheDocument();
  });

  // Dois elementos, duas ações: abrir a conversa (a linha) e finalizar sem
  // motivo (o botão). Botão DENTRO de role="button" é semântica inválida e
  // levava "Finalizar sem motivo" para o nome da linha.
  test('[FICA] "Finalizar sem motivo" é irmão da linha, no mesmo item, fora do nome dela', async () => {
    const linha = await abrirEspera();
    const item = itemDe(linha);
    const finalizar = within(item).getByRole('button', { name: 'Finalizar sem motivo' });

    expect(linha).not.toContainElement(finalizar);
    expect(linha).not.toHaveAccessibleName(/Finalizar/);
  });

  // [MUDA] No redesenho a 2ª linha da Espera COMEÇA pela localidade. Hoje a
  // prévia vem antes dela na leitura. Vira:
  // `expect(linha).toHaveAccessibleName(/Barão de Tromaí.*Minha internet caiu de novo/)`.
  test('[MUDA] hoje a prévia é lida antes da localidade', async () => {
    const linha = await abrirEspera();
    expect(linha).toHaveAccessibleName(/Minha internet caiu de novo.*Barão de Tromaí/);
  });
});

describe('linha compacta — aba Automação', () => {
  async function abrirAutomacao() {
    renderInShell(<DashboardPage />);
    await userEvent.click(screen.getByRole('tab', { name: /automação/i }));
    return linhaDe('Francisca Lima');
  }

  test('[FICA] "IA em triagem", hora de chegada, localidade · município', async () => {
    const linha = await abrirAutomacao();

    expect(within(linha).getByText('IA em triagem')).toBeInTheDocument();
    expect(within(linha).getByText(hora(CHEGADA))).toBeInTheDocument();
    expect(linha).toHaveAccessibleName(/Barão de Tromaí · Cândido Mendes/);
  });

  test('[FICA] "Finalizar sem motivo" também na Automação, fora da linha', async () => {
    const linha = await abrirAutomacao();
    const finalizar = within(itemDe(linha)).getByRole('button', { name: 'Finalizar sem motivo' });
    expect(linha).not.toContainElement(finalizar);
  });
});
