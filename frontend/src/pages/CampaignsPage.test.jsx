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
    api.listCampaigns.mockResolvedValue([
      { id: 'campaign-1', name: 'Aviso setembro', channelName: 'Berg', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
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
      { id: 'campaign-1', name: 'Aviso setembro', channelName: 'Berg', totalRecipients: 45, sentCount: 42, failedCount: 2, skippedCount: 1, createdAt: '2026-09-11T10:00:00Z' },
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
