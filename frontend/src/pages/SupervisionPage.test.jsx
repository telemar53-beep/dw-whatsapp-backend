import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import SupervisionPage from './SupervisionPage';
import { useAttendanceDashboard } from '../hooks/useAttendanceDashboard';
import { useChannels } from '../hooks/useChannels';
import { useAgents } from '../hooks/useAgents';
import { useSectors } from '../hooks/useSectors';
import { useAuth } from '../contexts/AuthContext';
import {
  getDashboardClosedToday,
  getDashboardConversationByProtocol,
  getDashboardConversationsByPhone,
  getPublicCompany,
} from '../services/api';
import { useConversationMessages } from '../hooks/useConversationMessages';
import { useQuickReplies } from '../hooks/useQuickReplies';
import { useAiSuggestion } from '../hooks/useAiSuggestion';
import * as api from '../services/api';

vi.mock('../hooks/useAttendanceDashboard');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useAgents');
vi.mock('../hooks/useSectors');
vi.mock('../contexts/AuthContext');
vi.mock('../services/api');
vi.mock('../hooks/useConversationMessages');
vi.mock('../hooks/useQuickReplies');
vi.mock('../hooks/useAiSuggestion');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Só dados fictícios.
const AGORA = Date.now();
const haMin = (m) => new Date(AGORA - m * 60000).toISOString();

const CARLOS = {
  id: 'c1', contactId: 'ct1', contactDisplayName: 'Carlos', contactPhoneNumber: '5500000000011', protocolNumber: '20260924-0011',
  channelId: 'chan-1', assignedAgentId: 'agent-1', sectorId: 'sector-1', sectorName: 'Financeiro', status: 'assigned',
  createdAt: haMin(40), lastMessageAt: haMin(24),
};
const MARIA = {
  id: 'c2', contactId: 'ct2', contactDisplayName: 'Maria', contactPhoneNumber: '5500000000012', protocolNumber: '20260924-0012',
  channelId: 'chan-1', assignedAgentId: null, sectorId: null, status: 'waiting', createdAt: haMin(11), lastMessageAt: haMin(10),
};
const TEREZA = {
  id: 'c4', contactId: 'ct4', contactDisplayName: 'Tereza', contactPhoneNumber: '5500000000014', protocolNumber: '20260924-0014',
  channelId: 'chan-2', assignedAgentId: null, sectorId: 'sector-1', sectorName: 'Financeiro', aiTriageReasonName: 'Segunda via',
  // Chegou antes da Maria, mas falou por último: a ordem da Espera é pela
  // chegada, e esta massa distingue as duas chaves.
  status: 'waiting', createdAt: haMin(18), lastMessageAt: haMin(2),
};
const JOAO = {
  id: 'c3', contactId: 'ct3', contactDisplayName: 'Joao', contactPhoneNumber: '5500000000013', protocolNumber: '20260924-0013',
  channelId: 'chan-1', assignedAgentId: null, sectorId: null, status: 'waiting', triageState: 'pending', createdAt: haMin(3), lastMessageAt: haMin(3),
};

function painel(extra = {}) {
  return {
    inProgress: [CARLOS], waiting: [MARIA, TEREZA], inAutomation: [JOAO], closedTodayCount: 7,
    status: 'ready', loading: false, refresh: vi.fn(), aplicarContatoSalvo: vi.fn(), ...extra,
  };
}

function renderPage(entradas) {
  return renderInShell(<SupervisionPage />, { path: '/supervisao', initialEntries: entradas || ['/supervisao'] });
}

const lista = () => screen.getByRole('region', { name: /^Conversas/ });
const linha = (nome) => within(lista()).getByRole('button', { name: new RegExp(nome) });
const indicadores = () => screen.getByRole('group', { name: 'Resumo da operação' });
const equipe = () => screen.getByRole('complementary', { name: 'Equipe' });
const busca = () => screen.getByRole('searchbox', { name: 'Buscar cliente, telefone ou protocolo' });

async function abrirFiltros(user) {
  await user.click(screen.getByRole('button', { name: /^Filtros/ }));
  return screen.getByRole('dialog', { name: 'Filtros' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-9', role: 'admin' } });
  useChannels.mockReturnValue({
    channels: [{ id: 'chan-1', name: 'WhatsApp Vendas' }, { id: 'chan-2', name: 'WhatsApp Suporte' }],
    loading: false, refresh: vi.fn(),
  });
  useAgents.mockReturnValue({ agents: [{ id: 'agent-1', name: 'Ana', email: 'ana@exemplo.test', online: true }], status: 'ready' });
  useSectors.mockReturnValue({ sectors: [{ id: 'sector-1', name: 'Financeiro' }], loading: false, refresh: vi.fn() });
  getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  getPublicCompany.mockResolvedValue({ name: '' });
  useConversationMessages.mockReturnValue({ messages: [], sendMessage: vi.fn() });
  useQuickReplies.mockReturnValue({ quickReplies: [], refresh: vi.fn() });
  useAiSuggestion.mockReturnValue({ suggestion: null, send: vi.fn(), edit: vi.fn(), discard: vi.fn() });
  useAttendanceDashboard.mockReturnValue(painel());
});

describe('Supervisão: estrutura', () => {
  test('título, busca única, Filtros e as abas Ao vivo e Últimas 24 h', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Supervisão' })).toBeInTheDocument();
    expect(screen.getByText('Operação em tempo real')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar cliente, telefone ou protocolo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filtros/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('tab', { name: 'Ao vivo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Últimas 24 h' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('tab', { name: /encerrados hoje/i })).not.toBeInTheDocument();
  });

  test('abas pelo teclado: setas alternam, Home e End vão às pontas, e o foco acompanha', async () => {
    const user = userEvent.setup();
    renderPage();
    screen.getByRole('tab', { name: 'Ao vivo' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Últimas 24 h' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Últimas 24 h' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Ao vivo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Ao vivo' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Últimas 24 h' })).toHaveFocus();
  });

  test('os grupos vêm na ordem Espera, Em atendimento, Automação', () => {
    renderPage();
    const grupos = within(lista()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(grupos).toEqual(['Espera', 'Em atendimento', 'Automação']);
  });

  test('a Espera ordena pelo maior tempo aguardando', () => {
    renderPage();
    const espera = within(lista()).getByRole('heading', { level: 3, name: 'Espera' }).closest('section');
    const nomes = within(espera).getAllByRole('button').map((b) => b.textContent);
    expect(nomes[0]).toMatch(/Tereza/);
    expect(nomes[1]).toMatch(/Maria/);
    expect(nomes[0]).toMatch(/18 min/);
  });

  test('cada linha diz o responsável, o setor e o tempo, com "Sem responsável" quando não há', () => {
    renderPage();
    expect(linha('Carlos')).toHaveTextContent('Ana');
    expect(linha('Carlos')).toHaveTextContent('Financeiro');
    expect(linha('Carlos')).toHaveTextContent('24 min');
    expect(linha('Maria')).toHaveTextContent('Sem responsável');
    expect(linha('Tereza')).toHaveTextContent('Segunda via');
    expect(linha('Joao')).toHaveTextContent('IA');
  });

  test('a foto do cliente fica fora do nome acessível da linha (o nome não sai em dobro)', () => {
    renderPage();
    expect(linha('Carlos').querySelector('.sv-linha-foto')).toHaveAttribute('aria-hidden', 'true');
  });

  test('a linha tem uma única ação — abrir — e nenhuma ação destrutiva', () => {
    renderPage();
    const itens = within(lista()).getAllByRole('listitem');
    itens.forEach((item) => expect(within(item).getAllByRole('button')).toHaveLength(1));
    expect(within(lista()).queryByRole('button', { name: /finalizar|encerrar|excluir/i })).not.toBeInTheDocument();
  });

  test('o rótulo do estado é "Em atendimento", nunca "Em andamento"', () => {
    renderPage();
    expect(screen.queryByText(/em andamento/i)).not.toBeInTheDocument();
    expect(within(indicadores()).getByRole('button', { name: /Em atendimento/ })).toBeInTheDocument();
  });

  test('indicadores com a contagem de cada estado e a equipe online', () => {
    renderPage();
    expect(within(indicadores()).getByRole('button', { name: /Espera\s*2/ })).toBeInTheDocument();
    expect(within(indicadores()).getByRole('button', { name: /Em atendimento\s*1/ })).toBeInTheDocument();
    expect(within(indicadores()).getByRole('button', { name: /Automação\s*1/ })).toBeInTheDocument();
    expect(within(indicadores()).getByRole('button', { name: /Equipe online\s*1/ })).toBeInTheDocument();
  });

  test('um indicador de estado mostra só aquele grupo, e clicar de novo volta tudo', async () => {
    const user = userEvent.setup();
    renderPage();
    const espera = within(indicadores()).getByRole('button', { name: /Espera/ });
    await user.click(espera);
    expect(espera).toHaveAttribute('aria-pressed', 'true');
    expect(within(lista()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Espera']);
    await user.click(espera);
    expect(within(lista()).getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  test('campanhas silenciosas não aparecem', () => {
    useAttendanceDashboard.mockReturnValue(painel({ waiting: [MARIA, { ...TEREZA, id: 'c8', contactDisplayName: 'Silvia', status: 'silent' }] }));
    renderPage();
    expect(within(lista()).queryByRole('button', { name: /Silvia/ })).not.toBeInTheDocument();
  });

  test('nome longo fica na linha inteiro para o leitor e contido pelo CSS', () => {
    const longo = 'Rosimeire Aparecida dos Santos Figueiredo de Albuquerque Neta';
    useAttendanceDashboard.mockReturnValue(painel({ waiting: [{ ...MARIA, contactDisplayName: longo }] }));
    renderPage();
    const nome = within(linha('Rosimeire')).getByText(longo);
    expect(nome).toHaveClass('sv-linha-nome');
    expect(nome).toHaveAttribute('title', longo);
  });
});

// O que a linha antiga (ConversationListItem compacto) dizia e continua
// dizendo na linha nova: o estado da IA e o lugar do cliente, uma vez só.
describe('Supervisão: o que a linha informa', () => {
  const LUGAR = { contactCityName: 'Cândido Mendes', contactLocalityName: 'Barão de Tromaí' };
  beforeEach(() => {
    useAttendanceDashboard.mockReturnValue(painel({
      inProgress: [{ ...CARLOS, ...LUGAR, lastMessageContent: 'Minha internet caiu de novo', aiTriageCompletedAt: haMin(30), aiTriageReasonName: 'Sem conexão', aiTriageLowConfidence: true }],
      waiting: [{ ...MARIA, aiTriageCompletedAt: haMin(9), aiTriageReasonName: 'Segunda via', aiTriageResolvedByAi: true }],
      inAutomation: [JOAO],
    }));
  });

  test('prévia da última mensagem, motivo da IA com o alerta de confiança baixa e o lugar uma vez', () => {
    renderPage();
    const carlos = linha('Carlos');
    expect(within(carlos).getByText('Minha internet caiu de novo')).toBeInTheDocument();
    expect(carlos).toHaveTextContent('IA · Sem conexão');
    expect(within(carlos).getByLabelText('Triagem com confiança baixa')).toHaveTextContent('⚠');
    expect(within(carlos).getAllByText(/Barão de Tromaí · Cândido Mendes/)).toHaveLength(1);
  });

  test('"Resolvido pela IA" e "IA em triagem" continuam aparecendo', () => {
    renderPage();
    expect(linha('Maria')).toHaveTextContent('Resolvido pela IA');
    expect(linha('Joao')).toHaveTextContent('IA em triagem');
  });

  test('mensagem enviada mostra os tiques de entrega na prévia', () => {
    useAttendanceDashboard.mockReturnValue(painel({ inProgress: [{ ...CARLOS, lastMessageContent: 'Pode testar agora?', lastMessageDirection: 'outbound', lastMessageStatus: 'delivered' }] }));
    renderPage();
    expect(within(linha('Carlos')).getByTitle('Entregue')).toBeInTheDocument();
  });
});

describe('Supervisão: busca única', () => {
  test('por nome, filtra a lista enquanto digita', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), 'mar');
    expect(linha('Maria')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Carlos/ })).not.toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Tereza/ })).not.toBeInTheDocument();
  });

  test('por telefone: filtra enquanto digita e, com Enter, busca todos os atendimentos do cliente', async () => {
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { id: 'ct9', phoneNumber: '5500000000099', displayName: 'Cliente Antiga' },
      conversations: [
        { id: 'h1', status: 'closed', contactDisplayName: 'Cliente Antiga', channelId: 'chan-1' },
        { id: 'h2', status: 'waiting', contactDisplayName: 'Cliente Antiga', channelId: 'chan-1' },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '5500000000012');
    expect(linha('Maria')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Carlos/ })).not.toBeInTheDocument();

    await user.clear(busca());
    await user.type(busca(), '+55 00 00000-0099{Enter}');
    expect(getDashboardConversationsByPhone).toHaveBeenCalledWith('+55 00 00000-0099', 'tok-123');
    const resultado = await screen.findByRole('region', { name: /Atendimentos de Cliente Antiga/ });
    expect(within(resultado).getAllByRole('button', { name: /Cliente Antiga/ })).toHaveLength(2);
  });

  test('por protocolo: Enter abre o atendimento no popup, sem navegar', async () => {
    getDashboardConversationByProtocol.mockResolvedValue({
      id: 'conv-found', status: 'closed', protocolNumber: '20260911-0001', contactDisplayName: 'Cliente Novo', assignedAgentId: 'agent-1',
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '20260911-0001{Enter}');
    expect(getDashboardConversationByProtocol).toHaveBeenCalledWith('20260911-0001', 'tok-123');
    expect(await screen.findByRole('dialog', { name: 'Conversa' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('protocolo antigo, só com números curtos, também vai para a busca de protocolo', async () => {
    getDashboardConversationByProtocol.mockResolvedValue({ id: 'conv-antiga', status: 'closed', protocolNumber: 1042, contactDisplayName: 'Cliente Antigo' });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '1042{Enter}');
    expect(getDashboardConversationByProtocol).toHaveBeenCalledWith('1042', 'tok-123');
    expect(getDashboardConversationsByPhone).not.toHaveBeenCalled();
  });

  test('a busca local também acha pelo protocolo', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '0014');
    expect(linha('Tereza')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Maria/ })).not.toBeInTheDocument();
  });

  test('protocolo inexistente: mensagem em português', async () => {
    getDashboardConversationByProtocol.mockRejectedValue({ body: { error: 'No conversation found with that protocol number' } });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '999999{Enter}');
    expect(await screen.findByText('Nenhum atendimento encontrado com esse protocolo.')).toBeInTheDocument();
  });

  test('telefone sem cliente: mensagem em português', async () => {
    getDashboardConversationsByPhone.mockRejectedValue({ body: { error: 'No contact found with that phone number' } });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '5500000000077{Enter}');
    expect(await screen.findByText('Nenhum cliente encontrado com esse telefone.')).toBeInTheDocument();
  });

  test('campanha silenciosa não aparece nos atendimentos do cliente, nem na contagem', async () => {
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { id: 'ct9', phoneNumber: '5500000000099', displayName: 'Cliente Antiga' },
      conversations: [
        { id: 'h1', status: 'closed', contactDisplayName: 'Cliente Antiga', channelId: 'chan-1' },
        { id: 'h3', status: 'silent', contactDisplayName: 'Cliente Antiga', channelId: 'chan-1' },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '5500000000099{Enter}');
    const resultado = await screen.findByRole('region', { name: 'Atendimentos de Cliente Antiga (1)' });
    expect(within(resultado).getAllByRole('button', { name: /Cliente Antiga/ })).toHaveLength(1);
  });

  test('um resultado da busca por telefone abre no popup, e "Limpar busca" volta à operação', async () => {
    getDashboardConversationsByPhone.mockResolvedValue({
      contact: { id: 'ct9', phoneNumber: '5500000000099', displayName: 'Cliente Antiga' },
      conversations: [{ id: 'h1', status: 'closed', contactDisplayName: 'Cliente Antiga', channelId: 'chan-1' }],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(busca(), '5500000000099{Enter}');
    const resultado = await screen.findByRole('region', { name: /Atendimentos de Cliente Antiga/ });
    await user.click(within(resultado).getByRole('button', { name: /Cliente Antiga/ }));
    expect(await screen.findByRole('dialog', { name: 'Conversa' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /voltar para a lista/i }));

    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.queryByRole('region', { name: /Atendimentos de/ })).not.toBeInTheDocument();
    expect(busca()).toHaveValue('');
    expect(busca()).toHaveFocus();
    expect(linha('Carlos')).toBeInTheDocument();
  });
});

describe('Supervisão: filtros', () => {
  test('o popover abre pelo botão, com Canal, Atendente (com IA) e Setor', async () => {
    const user = userEvent.setup();
    renderPage();
    const pop = await abrirFiltros(user);
    expect(screen.getByRole('button', { name: /^Filtros/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(pop).getByRole('group', { name: 'Canal' })).toBeInTheDocument();
    const atendente = within(pop).getByRole('group', { name: 'Atendente' });
    expect(within(atendente).getByRole('checkbox', { name: 'IA' })).toBeInTheDocument();
    expect(within(atendente).getByRole('checkbox', { name: 'Ana' })).toBeInTheDocument();
    expect(within(pop).getByRole('group', { name: 'Setor' })).toBeInTheDocument();
  });

  test('canal esconde as conversas de outros canais', async () => {
    const user = userEvent.setup();
    renderPage();
    const pop = await abrirFiltros(user);
    await user.click(within(pop).getByRole('checkbox', { name: 'WhatsApp Suporte' }));
    expect(linha('Tereza')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Carlos/ })).not.toBeInTheDocument();
  });

  test('atendente IA mostra o que a IA triou ou está triando', async () => {
    useAttendanceDashboard.mockReturnValue(painel({ waiting: [{ ...MARIA, aiTriageCompletedAt: haMin(9) }, TEREZA] }));
    const user = userEvent.setup();
    renderPage();
    const pop = await abrirFiltros(user);
    await user.click(within(pop).getByRole('checkbox', { name: 'IA' }));
    expect(linha('Maria')).toBeInTheDocument();
    expect(linha('Joao')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Carlos/ })).not.toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Tereza/ })).not.toBeInTheDocument();
  });

  test('setor filtra pela conversa, e os filtros vão para a URL', async () => {
    const user = userEvent.setup();
    renderPage();
    const pop = await abrirFiltros(user);
    await user.click(within(pop).getByRole('checkbox', { name: 'Financeiro' }));
    expect(linha('Carlos')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Maria/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('setor=sector-1');
  });

  test('lê os filtros e a aba da URL', async () => {
    renderPage(['/supervisao?canal=chan-2&aba=encerrados']);
    expect(screen.getByRole('tab', { name: 'Últimas 24 h' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('list', { name: 'Filtros ativos' })).toHaveTextContent('Canal: WhatsApp Suporte');
  });

  test('chips: remover um filtro tira só aquele, e "Limpar filtros" tira todos preservando a aba', async () => {
    const user = userEvent.setup();
    renderPage(['/supervisao?canal=chan-2&setor=sector-1']);
    const chips = screen.getByRole('list', { name: 'Filtros ativos' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(2);

    await user.click(within(chips).getByRole('button', { name: 'Remover filtro Canal: WhatsApp Suporte' }));
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('canal=');
    expect(screen.getByTestId('location-search')).toHaveTextContent('setor=sector-1');

    await user.click(screen.getByRole('tab', { name: 'Últimas 24 h' }));
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.queryByRole('list', { name: 'Filtros ativos' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Últimas 24 h' })).toHaveAttribute('aria-selected', 'true');
  });

  test('o × do chip e "Limpar filtros" somem no clique: o foco vai para o botão Filtros', async () => {
    const user = userEvent.setup();
    renderPage(['/supervisao?canal=chan-2&setor=sector-1']);
    await user.click(screen.getByRole('button', { name: 'Remover filtro Canal: WhatsApp Suporte' }));
    expect(screen.getByRole('button', { name: /^Filtros/ })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByRole('button', { name: /^Filtros/ })).toHaveFocus();
  });

  test('o botão Filtros mostra quantos filtros estão ativos', () => {
    renderPage(['/supervisao?canal=chan-2&setor=sector-1&atendente=ai']);
    expect(screen.getByRole('button', { name: /^Filtros/ })).toHaveTextContent('3');
  });

  test('filtro que esconde tudo diz que a causa são os filtros', async () => {
    renderPage(['/supervisao?canal=chan-9']);
    expect(screen.getByText('Nenhuma conversa em espera com os filtros atuais.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma conversa em atendimento com os filtros atuais.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma conversa em automação com os filtros atuais.')).toBeInTheDocument();
  });

  test('teclado: foco no primeiro filtro, Esc fecha e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    renderPage();
    const botao = screen.getByRole('button', { name: /^Filtros/ });
    botao.focus();
    await user.keyboard('{Enter}');
    const pop = screen.getByRole('dialog', { name: 'Filtros' });
    expect(within(pop).getAllByRole('checkbox')[0]).toHaveFocus();
    await user.keyboard(' ');
    expect(within(pop).getAllByRole('checkbox')[0]).toBeChecked();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filtros' })).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
    expect(botao).toHaveAttribute('aria-expanded', 'false');
  });

  // No celular, um toque "fora" caía na linha de baixo e abria a conversa. O
  // fundo transparente do popover (só no celular, CSS) recebe esse toque.
  test('tocar no fundo do popover fecha os filtros sem abrir a conversa de baixo', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await abrirFiltros(user);
    const fundo = container.querySelector('.sv-filtros-fundo');
    expect(fundo).not.toBeNull();
    // Fechar já no mousedown tiraria o fundo da tela antes do clique, que
    // cairia no que estiver embaixo: quem fecha é o clique do próprio fundo.
    fireEvent.mouseDown(fundo);
    expect(screen.getByRole('dialog', { name: 'Filtros' })).toBeInTheDocument();
    await user.click(fundo);
    expect(screen.queryByRole('dialog', { name: 'Filtros' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Conversa' })).not.toBeInTheDocument();
  });

  test('clique fora fecha o popover', async () => {
    const user = userEvent.setup();
    renderPage();
    await abrirFiltros(user);
    await user.click(screen.getByRole('heading', { level: 1, name: 'Supervisão' }));
    expect(screen.queryByRole('dialog', { name: 'Filtros' })).not.toBeInTheDocument();
  });

  test('o Tab que sai do popover o fecha', async () => {
    const user = userEvent.setup();
    renderPage();
    const pop = await abrirFiltros(user);
    const ultimo = within(pop).getAllByRole('checkbox').at(-1);
    ultimo.focus();
    await user.tab();
    expect(screen.queryByRole('dialog', { name: 'Filtros' })).not.toBeInTheDocument();
  });
});

describe('Supervisão: equipe', () => {
  test('mostra online e carga; clicar no atendente filtra a lista', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(within(equipe()).getByText('1 online')).toBeInTheDocument();
    const ana = within(equipe()).getByRole('button', { name: /Ana/ });
    expect(ana).toHaveTextContent('Online');
    expect(ana).toHaveTextContent('1');
    await user.click(ana);
    expect(ana).toHaveAttribute('aria-pressed', 'true');
    expect(linha('Carlos')).toBeInTheDocument();
    expect(within(lista()).queryByRole('button', { name: /Maria/ })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Filtros ativos' })).toHaveTextContent('Atendente: Ana');
  });

  test('a carga da equipe vem do painel inteiro: filtrar a tela não zera o atendente', () => {
    renderPage(['/supervisao?canal=chan-2']);
    expect(within(lista()).queryByRole('button', { name: /Carlos/ })).not.toBeInTheDocument();
    expect(within(equipe()).getByRole('button', { name: /Ana/ })).toHaveTextContent('1');
  });

  test('busca de atendente filtra o painel', async () => {
    useAgents.mockReturnValue({
      agents: [{ id: 'agent-1', name: 'Ana', online: true }, { id: 'agent-2', name: 'Bruno', online: false }],
      status: 'ready',
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(within(equipe()).getByRole('searchbox', { name: 'Buscar atendente' }), 'bru');
    expect(within(equipe()).getByRole('button', { name: /Bruno/ })).toBeInTheDocument();
    expect(within(equipe()).queryByRole('button', { name: /Ana/ })).not.toBeInTheDocument();
  });

  // No celular a lista vem primeiro: o painel lateral fica DEPOIS dela no
  // documento (e o CSS o tira abaixo de 1200 px; ver SupervisionPage.estilo).
  test('o painel da equipe vem depois da lista no documento', () => {
    renderPage();
    expect(lista().compareDocumentPosition(equipe()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('no celular, a equipe fica atrás do botão e abre numa folha com o mesmo painel', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole('dialog', { name: 'Equipe' })).not.toBeInTheDocument();
    const botao = screen.getByRole('button', { name: /^Equipe, 1 online/ });
    await user.click(botao);
    const folha = await screen.findByRole('dialog', { name: 'Equipe' });
    expect(within(folha).getByRole('button', { name: /Ana/ })).toBeInTheDocument();
    await user.click(within(folha).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Equipe' })).not.toBeInTheDocument());
    expect(botao).toHaveFocus();
  });
});

describe('Supervisão: Últimas 24 h', () => {
  test('não busca os encerrados antes de a aba ser aberta', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(getDashboardClosedToday).not.toHaveBeenCalled();
    getDashboardClosedToday.mockResolvedValue({ items: [{ id: 'c9', contactDisplayName: 'Rita', channelId: 'chan-1', status: 'closed' }], hasMore: false, total: 1 });
    await user.click(screen.getByRole('tab', { name: 'Últimas 24 h' }));
    expect(getDashboardClosedToday).toHaveBeenCalledWith({ offset: 0, limit: 20 }, 'tok-123');
    const painelEncerrados = await screen.findByRole('region', { name: /Encerrados nas últimas 24 h/ });
    expect(within(painelEncerrados).getByRole('button', { name: /Rita/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Conversas/ })).not.toBeInTheDocument();
  });

  test('sem filtro, o total vem do painel ao vivo', async () => {
    useAttendanceDashboard.mockReturnValue(painel({ closedTodayCount: 57 }));
    getDashboardClosedToday.mockResolvedValue({ items: [{ id: 'c9', contactDisplayName: 'Rita', status: 'closed' }], hasMore: true, total: 57 });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Últimas 24 h' }));
    expect(await screen.findByRole('region', { name: /Encerrados nas últimas 24 h \(57\)/ })).toBeInTheDocument();
  });

  test('com filtro de canal, setor ou atendente, a busca vai filtrada ao servidor e usa o total dele', async () => {
    getDashboardClosedToday.mockResolvedValue({ items: [{ id: 'c9', contactDisplayName: 'Rita', channelId: 'chan-2', status: 'closed' }], hasMore: true, total: 12 });
    renderPage(['/supervisao?aba=encerrados&canal=chan-2&setor=sector-1&atendente=agent-1']);
    expect(await screen.findByRole('region', { name: /Encerrados nas últimas 24 h \(12\)/ })).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenCalledWith(
      { offset: 0, limit: 20, channelIds: ['chan-2'], agentIds: ['agent-1'], sectorIds: ['sector-1'] },
      'tok-123'
    );
  });

  test('com o filtro IA, que o servidor não conhece, filtra o que carregou e avisa que a contagem é parcial', async () => {
    getDashboardClosedToday.mockResolvedValue({
      items: [
        { id: 'c4', contactDisplayName: 'Pedro', status: 'closed', assignedAgentId: null, aiTriageResolvedByAi: true, aiTriageCompletedAt: haMin(50) },
        { id: 'c5', contactDisplayName: 'Lucia', status: 'closed', assignedAgentId: 'agent-1', aiTriageResolvedByAi: true },
      ],
      hasMore: true,
      total: 40,
    });
    renderPage(['/supervisao?aba=encerrados&atendente=ai']);
    const regiao = await screen.findByRole('region', { name: /Encerrados nas últimas 24 h/ });
    expect(getDashboardClosedToday).toHaveBeenCalledWith({ offset: 0, limit: 20 }, 'tok-123');
    expect(within(regiao).getByRole('button', { name: /Pedro/ })).toBeInTheDocument();
    expect(within(regiao).queryByRole('button', { name: /Lucia/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 correspondência entre 2 encerrados carregados/)).toBeInTheDocument();
  });

  test('no filtro IA, com tudo carregado e nenhum encerrado, a contagem é 0 confirmado', async () => {
    getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false, total: 0 });
    renderPage(['/supervisao?aba=encerrados&atendente=ai']);
    expect(await screen.findByRole('region', { name: 'Encerrados nas últimas 24 h (0)' })).toBeInTheDocument();
  });

  test('com a busca, a contagem do servidor sai e o aviso diz que é sobre o que carregou', async () => {
    getDashboardClosedToday.mockResolvedValue({
      items: [{ id: 'c10', contactDisplayName: 'Pedro', status: 'closed' }, { id: 'c11', contactDisplayName: 'Rita', status: 'closed' }],
      hasMore: true, total: 30,
    });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    await screen.findByRole('button', { name: /Pedro/ });
    await user.type(busca(), 'rita');
    expect(screen.getByRole('region', { name: 'Encerrados nas últimas 24 h' })).toBeInTheDocument();
    expect(screen.getByText('Busca nos 2 encerrados carregados: 1 resultado.')).toBeInTheDocument();
  });

  test('resposta atrasada da 1ª página, de um filtro que já mudou, é descartada', async () => {
    let responderAntiga;
    getDashboardClosedToday
      .mockImplementationOnce(() => new Promise((r) => { responderAntiga = r; }))
      .mockResolvedValueOnce({ items: [{ id: 'c20', contactDisplayName: 'Nova', status: 'closed', channelId: 'chan-2' }], hasMore: false, total: 1 });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    const pop = await abrirFiltros(user);
    await user.click(within(pop).getByRole('checkbox', { name: 'WhatsApp Suporte' }));
    expect(await screen.findByRole('button', { name: /Nova/ })).toBeInTheDocument();
    await act(async () => { responderAntiga({ items: [{ id: 'c21', contactDisplayName: 'Antiga', status: 'closed' }], hasMore: false, total: 1 }); });
    expect(screen.queryByRole('button', { name: /Antiga/ })).not.toBeInTheDocument();
  });

  test('"Carregar mais" que volta depois de o filtro mudar não se mistura à lista nova', async () => {
    let responderMais;
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', status: 'closed' }], hasMore: true, total: 2 })
      .mockImplementationOnce(() => new Promise((r) => { responderMais = r; }))
      .mockResolvedValueOnce({ items: [{ id: 'c20', contactDisplayName: 'Nova', status: 'closed', channelId: 'chan-2' }], hasMore: false, total: 1 });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    await screen.findByRole('button', { name: /Pedro/ });
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    const pop = await abrirFiltros(user);
    await user.click(within(pop).getByRole('checkbox', { name: 'WhatsApp Suporte' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: /Nova/ })).toBeInTheDocument();
    await act(async () => { responderMais({ items: [{ id: 'c11', contactDisplayName: 'Rita', status: 'closed' }], hasMore: true, total: 2 }); });
    expect(screen.queryByRole('button', { name: /Rita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Carregar/ })).not.toBeInTheDocument();
  });

  test('"Carregar mais" traz a próxima página', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', status: 'closed' }], hasMore: true, total: 2 })
      .mockResolvedValueOnce({ items: [{ id: 'c11', contactDisplayName: 'Rita', status: 'closed' }], hasMore: false, total: 2 });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    await screen.findByRole('button', { name: /Pedro/ });
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('button', { name: /Rita/ })).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenLastCalledWith({ offset: 1, limit: 20 }, 'tok-123');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  test('falha inicial vira alerta com "Tentar de novo", e não lista vazia', async () => {
    getDashboardClosedToday.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [{ id: 'c9', contactDisplayName: 'Selma', status: 'closed' }], hasMore: false, total: 1 });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível carregar os encerrados das últimas 24 h.');
    expect(screen.queryByText(/nenhuma conversa encerrada/i)).not.toBeInTheDocument();
    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: /Selma/ })).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenLastCalledWith({ offset: 0, limit: 20 }, 'tok-123');
  });

  test('falha no "Carregar mais" preserva a lista e repete a mesma página', async () => {
    getDashboardClosedToday
      .mockResolvedValueOnce({ items: [{ id: 'c10', contactDisplayName: 'Pedro', status: 'closed' }], hasMore: true, total: 2 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [{ id: 'c11', contactDisplayName: 'Rita', status: 'closed' }], hasMore: false, total: 2 });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    await screen.findByRole('button', { name: /Pedro/ });
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar mais encerrados.');
    expect(screen.getByRole('button', { name: /Pedro/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: /Rita/ })).toBeInTheDocument();
    expect(getDashboardClosedToday).toHaveBeenLastCalledWith({ offset: 1, limit: 20 }, 'tok-123');
  });

  test('vazio de verdade e vazio por filtro dizem coisas diferentes', async () => {
    const { unmount } = renderPage(['/supervisao?aba=encerrados']);
    expect(await screen.findByText('Nenhuma conversa encerrada nas últimas 24 h.')).toBeInTheDocument();
    unmount();
    renderPage(['/supervisao?aba=encerrados&canal=chan-2']);
    expect(await screen.findByText('Nenhuma conversa encerrada nas últimas 24 h com os filtros atuais.')).toBeInTheDocument();
  });

  test('um encerrado abre no popup, sem navegar', async () => {
    getDashboardClosedToday.mockResolvedValue({ items: [{ id: 'c9', contactDisplayName: 'Rita', status: 'closed', assignedAgentId: 'agent-1' }], hasMore: false, total: 1 });
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    await user.click(await screen.findByRole('button', { name: /Rita/ }));
    expect(await screen.findByRole('dialog', { name: 'Conversa' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Supervisão: carregando, vazio, erro e contadores', () => {
  test('carregando não se apresenta como operação vazia, e os contadores mostram —', () => {
    useAttendanceDashboard.mockReturnValue(painel({ inProgress: [], waiting: [], inAutomation: [], status: 'loading', loading: true }));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando conversas…');
    expect(screen.queryByText(/nenhuma conversa em/i)).not.toBeInTheDocument();
    within(indicadores()).getAllByRole('button').forEach((b) => expect(b).toHaveTextContent('—'));
  });

  test('erro mostra alerta com "Tentar de novo", e nenhum zero se passa por confirmado', async () => {
    const refresh = vi.fn();
    useAttendanceDashboard.mockReturnValue(painel({ inProgress: [], waiting: [], inAutomation: [], status: 'error', refresh }));
    const user = userEvent.setup();
    renderPage();
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível carregar as conversas.');
    ['Espera', 'Em atendimento', 'Automação'].forEach((rotulo) => {
      const b = within(indicadores()).getByRole('button', { name: new RegExp(rotulo) });
      expect(b).toHaveTextContent('—');
      expect(b).not.toHaveTextContent('0');
    });
    expect(within(equipe()).getAllByText('—').length).toBeGreaterThan(0);
    // "Não se sabe" não usa a cor de "confirmado": sem verde nem índigo.
    expect(within(equipe()).getByText(/online/).closest('.sv-equipe-online')).toHaveAttribute('data-desconhecido', 'true');
    within(indicadores()).getAllByRole('button').forEach((b) => expect(b.querySelector('.sv-indicador-valor')).toHaveAttribute('data-desconhecido', 'true'));
    await user.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('sem acesso: mensagem própria', () => {
    useAttendanceDashboard.mockReturnValue(painel({ inProgress: [], waiting: [], inAutomation: [], status: 'forbidden' }));
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Você não tem acesso ao painel de atendimentos.');
  });

  test('vazio de verdade diz que não há conversas, com 0 confirmado', () => {
    useAttendanceDashboard.mockReturnValue(painel({ inProgress: [], waiting: [], inAutomation: [] }));
    renderPage();
    expect(screen.getByText('Nenhuma conversa em espera.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma conversa em atendimento.')).toBeInTheDocument();
    expect(within(indicadores()).getByRole('button', { name: /Espera/ })).toHaveTextContent('0');
    expect(within(indicadores()).getByRole('button', { name: /Espera/ }).querySelector('.sv-indicador-valor')).not.toHaveAttribute('data-desconhecido');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Supervisão: o popup de antes continua abrindo', () => {
  test('clicar na linha abre a conversa no popup, sem navegar; fechar volta à lista', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(linha('Carlos'));
    const dialogo = await screen.findByRole('dialog', { name: 'Conversa' });
    expect(within(dialogo).getAllByText('Carlos').length).toBeGreaterThan(0);
    expect(mockNavigate).not.toHaveBeenCalled();
    await user.click(within(dialogo).getByRole('button', { name: /voltar para a lista/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('transferir dentro do popup abre a transferência', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(linha('Carlos'));
    await screen.findByRole('dialog', { name: 'Conversa' });
    await user.click(screen.getByRole('button', { name: /transferir atendimento/i }));
    expect(await screen.findByRole('heading', { name: 'Transferir atendimento' })).toBeInTheDocument();
  });
});

// O popup sai das listas da própria página. Com o hook do painel DE VERDADE:
// o que o "Editar cliente" salvou tem de estar lá quando o popup for reaberto.
describe('edição do contato na Supervisão: reabrir traz o que foi salvo', () => {
  let painelReal;
  beforeAll(async () => {
    painelReal = await vi.importActual('../hooks/useAttendanceDashboard');
  });

  const CARLOS_REAL = { ...CARLOS, contactId: 'contato-1', contactInternalNote: 'Nota antiga' };

  beforeEach(() => {
    useAttendanceDashboard.mockImplementation(painelReal.useAttendanceDashboard);
    api.getDashboardConversations.mockResolvedValue({ inProgress: [CARLOS_REAL], waiting: [], inAutomation: [], closedTodayCount: 0 });
    api.listCities.mockResolvedValue([]);
    api.updateContact.mockReset();
    api.updateContact.mockResolvedValue({ id: 'contato-1', displayName: 'Carlos', cityId: null, localityId: null, internalNote: 'Nota nova' });
  });

  test('Supervisão reaberta usa os dados novos', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Carlos/ }));
    const conversa1 = await screen.findByRole('dialog', { name: 'Conversa' });
    await user.click(within(conversa1).getByRole('button', { name: /^Editar cliente:/ }));
    const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
    const nota = within(edicao).getByLabelText('Nota interna');
    await user.clear(nota);
    await user.type(nota, 'Nota nova');
    await user.click(within(edicao).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /voltar para a lista/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Carlos/ }));
    const conversa = await screen.findByRole('dialog', { name: 'Conversa' });
    expect(within(within(conversa).getByRole('complementary')).getByText('Nota nova')).toBeInTheDocument();
  });
});

describe('edição do contato a partir das Últimas 24 h', () => {
  let painelReal;
  beforeAll(async () => {
    painelReal = await vi.importActual('../hooks/useAttendanceDashboard');
  });

  const RITA_ENC = {
    id: 'c9', contactId: 'contato-2', contactDisplayName: 'Rita', contactPhoneNumber: '5500000000019', status: 'closed',
    channelId: 'chan-1', contactInternalNote: 'Nota antiga', createdAt: haMin(90), lastMessageAt: haMin(40), closedAt: haMin(30),
  };

  beforeEach(() => {
    useAttendanceDashboard.mockImplementation(painelReal.useAttendanceDashboard);
    api.getDashboardConversations.mockResolvedValue({ inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 1 });
    getDashboardClosedToday.mockResolvedValue({ items: [RITA_ENC], hasMore: false, total: 1 });
    api.listCities.mockResolvedValue([]);
    api.updateContact.mockReset();
    api.updateContact.mockResolvedValue({ id: 'contato-2', displayName: 'Rita', cityId: null, localityId: null, internalNote: 'Nota nova' });
  });

  test('encerrado reaberto usa os dados novos', async () => {
    const user = userEvent.setup();
    renderPage(['/supervisao?aba=encerrados']);
    await user.click(await screen.findByRole('button', { name: /Rita/ }));
    const conversa1 = await screen.findByRole('dialog', { name: 'Conversa' });
    await user.click(within(conversa1).getByRole('button', { name: /^Editar cliente:/ }));
    const edicao = await screen.findByRole('dialog', { name: 'Editar cliente' });
    const nota = within(edicao).getByLabelText('Nota interna');
    await user.clear(nota);
    await user.type(nota, 'Nota nova');
    await user.click(within(edicao).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /voltar para a lista/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Rita/ }));
    const conversa = await screen.findByRole('dialog', { name: 'Conversa' });
    expect(within(within(conversa).getByRole('complementary')).getByText('Nota nova')).toBeInTheDocument();
  });
});

describe('Supervisão: tempo decorrido', () => {
  test('a Espera mostra o tempo desde a chegada; o atendimento, desde a última mensagem', () => {
    renderPage();
    expect(linha('Tereza')).toHaveTextContent('18 min');
    expect(linha('Carlos')).toHaveTextContent('24 min');
  });

  test('o tempo anda sozinho a cada minuto', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    try {
      vi.setSystemTime(AGORA);
      renderPage();
      expect(linha('Tereza')).toHaveTextContent('18 min');
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(linha('Tereza')).toHaveTextContent('19 min');
    } finally {
      vi.useRealTimers();
    }
  });
});
