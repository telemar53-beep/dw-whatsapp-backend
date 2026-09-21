import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import CampaignsPage from './CampaignsPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage() {
  return renderInShell(<CampaignsPage />, { path: '/campanhas' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
  api.listChannelsForAgent.mockResolvedValue([]);
});

describe('CampaignsPage', () => {
  test('lists existing campaigns with their counters', async () => {
    // O nome do canal vem SEMPRE da lista de canais: a rota de campanhas
    // devolve so as colunas da tabela, e `channelName` nunca esteve no payload.
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch1', name: 'Berg', type: 'baileys' }]);
    api.listCampaigns.mockResolvedValue([
      { id: 'campaign-1', name: 'Aviso setembro', channelId: 'ch1', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
    ]);
    renderPage();

    expect(await screen.findByText('Aviso setembro')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Aviso setembro/ })).getByText(/42/)).toBeInTheDocument();
    expect(await screen.findByText(/Berg/)).toBeInTheDocument();
  });

  test('shows a message when there are no campaigns yet', async () => {
    api.listCampaigns.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/nenhuma campanha/i)).toBeInTheDocument();
  });

  test('opens the create campaign modal', async () => {
    api.listCampaigns.mockResolvedValue([]);
    api.listChannelsForAgent.mockResolvedValue([]);
    renderPage();

    await screen.findByText(/nenhuma campanha/i);
    await userEvent.click(screen.getByRole('button', { name: /nova campanha/i }));

    expect(await screen.findByRole('heading', { name: 'Nova campanha' })).toBeInTheDocument();
  });

  test('adds the new campaign to the list after creating it', async () => {
    const newCampaign = { id: 'campaign-new', name: 'Nova', channelName: 'Berg', totalRecipients: 1, sentCount: 0, failedCount: 0, skippedCount: 0, createdAt: '2026-09-11T10:00:00Z' };
    api.listCampaigns.mockResolvedValueOnce([]).mockResolvedValueOnce([newCampaign]);
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue(newCampaign);
    renderPage();

    await screen.findByText(/nenhuma campanha/i);
    await userEvent.click(screen.getByRole('button', { name: /nova campanha/i }));
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar e disparar/i }));

    await waitFor(() => expect(screen.getByText('Nova')).toBeInTheDocument());
  });

  // Fix: a página usava useChannels() (GET /api/admin/channels), que devolve
  // 403 para atendente comum — o nome do canal ficava em branco. Agora usa
  // useAgentChannels() (GET /api/channels), liberado para qualquer autenticado.
  test('um atendente (não-admin) vê o nome do canal, sem chamar o endpoint admin', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', name: 'Ana', role: 'agent' }, logout: vi.fn() });
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch1', name: 'Berg', type: 'baileys' }]);
    api.listCampaigns.mockResolvedValue([
      { id: 'campaign-1', name: 'Aviso setembro', channelId: 'ch1', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
    ]);
    renderPage();

    expect(await screen.findByText(/Berg/)).toBeInTheDocument();
    expect(api.listChannels).not.toHaveBeenCalled();
  });

  test('links each campaign to its detail page', async () => {
    api.listCampaigns.mockResolvedValue([
      { id: 'campaign-1', name: 'Aviso setembro', channelId: 'ch1', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
    ]);
    renderPage();

    const link = await screen.findByRole('link', { name: /Aviso setembro/ });
    expect(link).toHaveAttribute('href', '/campanhas/campaign-1');
  });
});

// Etapa 6.5 — a lista carregava uma vez e ficava: campanha disparando mostrava
// numeros congelados e nao havia como atualizar.
describe('atualizacao da lista', () => {
  const EM_ANDAMENTO = { id: 'c1', name: 'Aviso', channelName: 'Berg', totalRecipients: 10, sentCount: 4, failedCount: 0, skippedCount: 0, createdAt: '2026-09-21T10:00:00Z' };
  const TERMINADA = { ...EM_ANDAMENTO, sentCount: 10 };

  test('o botao "Atualizar" rebusca sem transformar a lista em skeleton', async () => {
    api.listCampaigns
      .mockResolvedValueOnce([TERMINADA])
      .mockResolvedValueOnce([{ ...TERMINADA, name: 'Aviso revisado' }]);
    renderPage();
    expect(await screen.findByText('Aviso')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atualizar/i }));

    // A lista nunca some: o nome antigo so e substituido pelo novo.
    expect(await screen.findByText('Aviso revisado')).toBeInTheDocument();
    expect(api.listCampaigns).toHaveBeenCalledTimes(2);
  });

  test('uma falha na atualizacao nao apaga a lista que ja esta na tela', async () => {
    api.listCampaigns
      .mockResolvedValueOnce([TERMINADA])
      .mockRejectedValueOnce(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Aviso')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atualizar/i }));

    await waitFor(() => expect(api.listCampaigns).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Aviso')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('com campanha ainda processando, atualiza sozinha a cada 10s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listCampaigns.mockResolvedValue([EM_ANDAMENTO]);
    renderPage();
    await screen.findByText('Aviso');
    expect(api.listCampaigns).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10000);
    expect(api.listCampaigns).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.listCampaigns).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  test('com todas processadas, nao fica consultando a toa', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listCampaigns.mockResolvedValue([TERMINADA]);
    renderPage();
    await screen.findByText('Aviso');

    await vi.advanceTimersByTimeAsync(30000);

    expect(api.listCampaigns).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('cada numero da linha tem rotulo para leitor de tela', async () => {
    api.listCampaigns.mockResolvedValue([TERMINADA]);
    renderPage();

    const linha = await screen.findByRole('link', { name: /aviso/i });
    // A linha de cabecalho e aria-hidden; sem esses rotulos a leitura era so
    // uma sequencia de numeros sem significado.
    ['Destinatários', 'Enviados', 'Falharam', 'Pulados', 'Processados'].forEach((rotulo) => {
      expect(linha).toHaveAccessibleName(new RegExp(rotulo, 'i'));
    });
  });
});

// Etapa 6.6 — busca, ordenacao e situacao derivada.
describe('busca, ordenacao e situacao', () => {
  const base = { totalRecipients: 10, sentCount: 10, failedCount: 0, skippedCount: 0 };
  const LISTA = [
    { ...base, id: 'c1', name: 'Aviso de manutencao', channelId: 'ch1', createdAt: '2026-09-20T10:00:00Z', failedCount: 0 },
    { ...base, id: 'c2', name: 'Black friday', channelId: 'ch2', createdAt: '2026-09-18T10:00:00Z', totalRecipients: 500, sentCount: 480, failedCount: 20 },
    { ...base, id: 'c3', name: 'Cobranca', channelId: 'ch1', createdAt: '2026-09-19T10:00:00Z', totalRecipients: 30, sentCount: 10, failedCount: 0, skippedCount: 0 },
  ];

  function comCanais() {
    api.listChannelsForAgent.mockResolvedValue([
      { id: 'ch1', name: 'Suporte', type: 'baileys' },
      { id: 'ch2', name: 'Marketing', type: 'meta_cloud' },
    ]);
    api.listCampaigns.mockResolvedValue(LISTA);
  }

  const nomesNaOrdem = () => screen.getAllByRole('link').map((a) => a.textContent).filter((t) => /Aviso|Black|Cobranca/.test(t)).map((t) => t.match(/Aviso de manutencao|Black friday|Cobranca/)[0]);

  test('busca por nome filtra a lista', async () => {
    comCanais();
    renderPage();
    await screen.findByText('Black friday');

    await userEvent.type(screen.getByLabelText(/buscar campanha/i), 'black');

    await waitFor(() => expect(screen.queryByText('Aviso de manutencao')).not.toBeInTheDocument());
    expect(screen.getByText('Black friday')).toBeInTheDocument();
  });

  test('busca tambem casa pelo nome do canal', async () => {
    comCanais();
    renderPage();
    await screen.findByText('Black friday');

    await userEvent.type(screen.getByLabelText(/buscar campanha/i), 'marketing');

    await waitFor(() => expect(screen.queryByText('Cobranca')).not.toBeInTheDocument());
    expect(screen.getByText('Black friday')).toBeInTheDocument();
  });

  test('busca sem resultado nao se confunde com "nenhuma campanha criada"', async () => {
    comCanais();
    renderPage();
    await screen.findByText('Black friday');

    await userEvent.type(screen.getByLabelText(/buscar campanha/i), 'inexistente');

    expect(await screen.findByText(/nenhuma campanha corresponde a/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma campanha criada ainda/i)).not.toBeInTheDocument();
  });

  test('ordena por nome, por destinatarios e por falhas', async () => {
    comCanais();
    renderPage();
    await screen.findByText('Black friday');
    const select = screen.getByLabelText(/ordenar por/i);

    await userEvent.selectOptions(select, 'nome');
    expect(nomesNaOrdem()).toEqual(['Aviso de manutencao', 'Black friday', 'Cobranca']);

    await userEvent.selectOptions(select, 'destinatarios');
    expect(nomesNaOrdem()[0]).toBe('Black friday');

    await userEvent.selectOptions(select, 'falhas');
    expect(nomesNaOrdem()[0]).toBe('Black friday');

    await userEvent.selectOptions(select, 'antigas');
    expect(nomesNaOrdem()[0]).toBe('Black friday');
  });

  test('a linha diz se a campanha terminou, sem inventar estado', async () => {
    comCanais();
    renderPage();

    const terminada = await screen.findByRole('link', { name: /aviso de manutencao/i });
    expect(terminada).toHaveTextContent('Todos processados');
    const andando = screen.getByRole('link', { name: /cobranca/i });
    expect(andando).toHaveTextContent('Processando');

    // Nenhuma das palavras que os dados atuais nao permitem afirmar.
    expect(document.body.textContent).not.toMatch(/travad|pausad|cancelad|em atraso/i);
  });

  test('createdAt ausente nao vira "Invalid Date"', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch1', name: 'Suporte', type: 'baileys' }]);
    api.listCampaigns.mockResolvedValue([{ ...base, id: 'c9', name: 'Sem data', channelId: 'ch1', createdAt: null }]);
    renderPage();

    expect(await screen.findByText(/data não informada/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
  });

  test('milhares aparecem com separador tambem nas linhas', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch1', name: 'Suporte', type: 'baileys' }]);
    api.listCampaigns.mockResolvedValue([{ id: 'c9', name: 'Grande', channelId: 'ch1', createdAt: '2026-09-20T10:00:00Z', totalRecipients: 1240, sentCount: 1240, failedCount: 0, skippedCount: 0 }]);
    renderPage();

    const linha = await screen.findByRole('link', { name: /grande/i });
    expect(linha).toHaveTextContent('1.240');
  });
});
