import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import * as api from './services/api';
import { io } from 'socket.io-client';

vi.mock('./services/api');
vi.mock('socket.io-client');

function loginAs(agent) {
  localStorage.setItem('dw_token', 'tok-123');
  localStorage.setItem('dw_agent', JSON.stringify(agent));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.getQueue.mockResolvedValue([]);
  api.getMyConversations.mockResolvedValue([]);
  api.listChannels.mockResolvedValue([]);
  api.listAgents.mockResolvedValue([]);
  api.listSectors.mockResolvedValue([]);
  // A rota padrão de /configuracoes agora é a lista de Canais (Task 17), que
  // busca a config de triagem e de IA para montar os avisos de cada canal.
  api.getTriage.mockResolvedValue({ questionText: '', confirmationText: '', maxAttempts: 2, options: [] });
  api.getAiConfig.mockResolvedValue({ configured: false, mode: 'disabled', model: '', nightStartTime: null, nightEndTime: null });
  api.getDashboardConversations.mockResolvedValue({ inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0 });
  api.getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  api.listCampaigns.mockResolvedValue([]);
  api.getMetrics.mockResolvedValue({ period: 'today', scope: 'agent', own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null } });
});

describe('rotas', () => {
  test('/admin/dashboard redireciona para /supervisao preservando a query', async () => {
    loginAs({ id: 'a1', role: 'admin' });
    window.history.pushState({}, '', '/admin/dashboard?canal=ch1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /dashboard de atendimento|supervisão/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/supervisao');
    expect(window.location.search).toBe('?canal=ch1');
  });

  test('/metrics redireciona para /relatorios', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/metrics');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /relatório/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/relatorios');
  });

  test('/campaigns/abc redireciona para /campanhas/abc', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    api.getCampaign.mockResolvedValue({ id: 'abc', name: 'Promo', sentCount: 0, failedCount: 0, skippedCount: 0, totalRecipients: 0, processedCount: 0, recipients: [] });
    window.history.pushState({}, '', '/campaigns/abc');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Promo' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/campanhas/abc');
  });

  test('/configuracoes leva o admin à primeira página permitida', async () => {
    loginAs({ id: 'a1', role: 'admin' });
    window.history.pushState({}, '', '/configuracoes');
    render(<App />);
    const navs = await screen.findAllByRole('navigation', { name: /navegação principal/i });
    expect(navs.length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/configuracoes/canais');
  });

  test('atendente em /supervisao vê acesso negado dentro do shell', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/supervisao');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /sem acesso a supervisão/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument();
  });

  test('o menu marca Relatórios como ativo em /relatorios', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/relatorios');
    render(<App />);
    const links = await screen.findAllByRole('link', { name: /relatórios/i });
    expect(links.some((el) => el.getAttribute('aria-current') === 'page')).toBe(true);
  });
});
