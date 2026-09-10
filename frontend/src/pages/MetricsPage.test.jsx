import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MetricsPage from './MetricsPage';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

// Recharts' ResponsiveContainer relies on real DOM layout (getBoundingClientRect),
// which jsdom doesn't provide — it renders nothing in tests. Stub the pieces this
// page uses with simple elements that expose the data as visible text, so tests can
// assert on what data reached the chart without fighting jsdom's lack of layout.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  BarChart: ({ data }) => (
    <div data-testid="bar-chart">
      {data.map((item, i) => (
        <div key={i}>{JSON.stringify(item)}</div>
      ))}
    </div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <MetricsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'agent-1', role: 'agent' } });
});

describe('MetricsPage', () => {
  test('shows own metrics for a non-admin agent', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 },
    });
    renderPage();

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
  });

  test('shows a dash for a metric with no data yet', async () => {
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'agent',
      own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null },
    });
    renderPage();

    await screen.findByText('0');
    expect(screen.getAllByText('-')).toHaveLength(2);
  });

  test('shows the per-agent and per-sector charts for an admin', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 5, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [{ sectorId: 's1', sectorName: 'Financeiro', closedCount: 5 }],
      byReason: [],
    });
    renderPage();

    // "Ana" appears in two chart sections (atendimentos por atendente AND tempo médio
    // por atendente both render `data.byAgent`) — the sector chart uses a different
    // array and appears exactly once.
    await screen.findAllByText(/"agentName":"Ana"/);
    expect(screen.getAllByText(/"agentName":"Ana"/)).toHaveLength(2);
    expect(screen.getByText(/"sectorName":"Financeiro"/)).toBeInTheDocument();
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

    expect(await screen.findAllByText('Nenhum atendimento fechado nesse período.')).toHaveLength(4);
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  test('shows charts for byAgent but an empty-state for bySector when only bySector is empty', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 5, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [],
      byReason: [],
    });
    renderPage();

    await screen.findAllByText(/"agentName":"Ana"/);
    expect(screen.getAllByText(/"agentName":"Ana"/)).toHaveLength(2);
    // Both bySector and byReason are empty here, so their charts each render their
    // own empty state.
    expect(screen.getAllByText('Nenhum atendimento fechado nesse período.')).toHaveLength(2);
  });

  test('shows the per-reason chart for an admin', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [],
      bySector: [],
      byReason: [{ reasonId: 'r1', reasonName: 'Troca de senha', closedCount: 4 }],
    });
    renderPage();

    expect(await screen.findByText(/"reasonName":"Troca de senha"/)).toBeInTheDocument();
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

    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('today', 'tok-123', 45));
  });
});
