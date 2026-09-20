import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInShell } from '../test-utils/renderInShell';
import ReportsPage from './ReportsPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

function renderPage() {
  return renderInShell(<ReportsPage />, { path: '/relatorios' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
});

describe('ReportsPage', () => {
  test('shows own metrics for a non-admin agent', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 },
    });
    renderPage();

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('13 min')).toBeInTheDocument();
    expect(screen.getByText('4 min')).toBeInTheDocument();
  });

  test('shows a dash for a metric with no data yet', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null },
    });
    renderPage();

    await screen.findByText('0');
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  test('shows agent volumes and times together with sector distribution for an admin', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 5, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [{ sectorId: 's1', sectorName: 'Financeiro', closedCount: 5 }],
      byReason: [],
    });
    renderPage();

    expect(await screen.findByRole('rowheader', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('10 min');
    expect(screen.getByRole('table')).toHaveTextContent('2 min');
  });

  test('shows an empty-state message instead of charts when an admin has no data', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [],
      bySector: [],
      byReason: [],
    });
    renderPage();

    expect(await screen.findAllByText('Nenhum atendimento fechado nesse período.')).toHaveLength(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('keeps the agent comparison when sector and reason distributions are empty', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 5, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [],
      byReason: [],
    });
    renderPage();

    expect(await screen.findByRole('rowheader', { name: 'Ana' })).toBeInTheDocument();
    // Both bySector and byReason are empty here, so their charts each render their
    // own empty state.
    expect(screen.getAllByText('Nenhum atendimento fechado nesse período.')).toHaveLength(2);
  });

  test('shows the reason distribution for an admin', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [],
      bySector: [],
      byReason: [{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 4 }],
    });
    renderPage();

    expect(await screen.findByText('Troca de senha')).toBeInTheDocument();
  });

  test('switching period refetches metrics with the new period', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('today', 'tok-123', null));

    await userEvent.click(screen.getByRole('button', { name: /últimos 7 dias/i }));

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('7d', 'tok-123', null));
  });

  test('shows an error message when the fetch fails', async () => {
    api.getMetrics.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText(/falha ao carregar métricas/i)).toBeInTheDocument();
  });

  test('clicking Personalizado reveals the custom days input, hidden by default', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledTimes(1));

    expect(screen.queryByLabelText(/últimos/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));

    expect(screen.getByLabelText(/últimos/i)).toBeInTheDocument();
  });

  test('applying a valid custom days value fetches with period=custom', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    await userEvent.type(screen.getByLabelText(/últimos/i), '45');
    await userEvent.click(screen.getByRole('button', { name: /aplicar/i }));

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('custom', 'tok-123', 45));
  });

  test('the Aplicar button stays disabled for an invalid custom days value', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));

    expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/últimos/i), '400');

    expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled();
  });

  // Fix: periodo=custom chegando pela URL sem um "dias" válido (1..365) —
  // link colado à mão, favorito antigo, "dias" apagado — ficava preso em
  // "Carregando indicadores..." pra sempre, porque o efeito de busca só
  // rodava com customDays truthy. Agora cai para "today".
  test('periodo=custom sem dias válido na URL cai para hoje em vez de travar carregando', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 7, avgResolutionMinutes: 5, avgFirstResponseMinutes: 2 },
    });
    renderInShell(<ReportsPage />, { path: '/relatorios', initialEntries: ['/relatorios?periodo=custom'] });

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('today', 'tok-123', null));
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /últimas 24 horas/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('o texto de ajuda explica que motivos inclui a IA mas o resto só conta atendentes', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /o que é isso/i }));

    expect(screen.getByText(/motivos de contato inclui também os atendimentos encerrados pela ia/i)).toBeInTheDocument();
  });

  test('switching back to a fixed period after a custom one refetches with that period', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 },
    });
    renderPage();
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    await userEvent.type(screen.getByLabelText(/últimos/i), '45');
    await userEvent.click(screen.getByRole('button', { name: /aplicar/i }));
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('custom', 'tok-123', 45));

    await userEvent.click(screen.getByRole('button', { name: /últimas 24 horas/i }));

    // O período volta a ser lido da URL: ao sair de "custom" o parâmetro `dias`
    // é removido, então o dia customizado não vaza para o período fixo.
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('today', 'tok-123', null));
  });

  test('exporting downloads a CSV named after the period', async () => {
    // The CSV content itself (including the BOM prefix, delimiter, and section
    // layout) is covered by exportMetricsCsv.test.js against the pure builder
    // function — this test only checks the download glue: filename, blob type,
    // and that the temporary link is created, clicked, and cleaned up.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function noop() {});
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 },
    });
    renderPage();
    await screen.findByText('3');

    await userEvent.click(screen.getByRole('button', { name: /exportar csv/i }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0];
    expect(anchor.download).toMatch(/^relatorio-today-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
  });

  test('the export button is disabled before metrics finish loading', () => {
    api.getMetrics.mockImplementation(() => new Promise(() => {})); // never resolves during this test
    renderPage();

    expect(screen.getByRole('button', { name: /exportar csv/i })).toBeDisabled();
  });

  test('mostra tempos legíveis em vez de minutos crus', async () => {
    api.getMetrics.mockResolvedValue({ period: 'today', scope: 'agent', own: { closedCount: 3, avgResolutionMinutes: 85.3, avgFirstResponseMinutes: 4.2 } });
    renderInShell(<ReportsPage />, { path: '/relatorios' });
    expect(await screen.findByText('1 h 25 min')).toBeInTheDocument();
    expect(screen.getByText('4 min')).toBeInTheDocument();
  });

  test('lê o período da URL e escreve ao trocar', async () => {
    api.getMetrics.mockResolvedValue({ period: '7d', scope: 'agent', own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null } });
    renderInShell(<ReportsPage />, { path: '/relatorios', initialEntries: ['/relatorios?periodo=7d'] });
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('7d', 'tok-123', null));
    await userEvent.click(screen.getByRole('button', { name: /últimos 30 dias/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('periodo=30d');
  });

  test('explica o critério dos tempos', async () => {
    api.getMetrics.mockResolvedValue({ period: 'today', scope: 'agent', own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null } });
    renderInShell(<ReportsPage />, { path: '/relatorios' });
    await userEvent.click(await screen.findByRole('button', { name: /como os tempos são calculados/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/começa quando a conversa é criada/i);
    expect(screen.getByRole('dialog')).toHaveTextContent(/inclui o tempo em espera, na triagem e com a IA/i);
  });

  test('pinta a barra "Sem setor" como sem setor', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today', scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 2, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [{ sectorId: null, sectorName: 'Sem setor', closedCount: 2 }],
      byReason: [],
    });
    renderInShell(<ReportsPage />, { path: '/relatorios' });
    expect(await screen.findByText('Sem setor')).toBeInTheDocument();
    expect(screen.getByText(/encerradas sem setor definido/i)).toBeInTheDocument();
  });
});
