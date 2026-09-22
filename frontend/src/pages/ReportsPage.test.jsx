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
  // "Carregando indicadores…" pra sempre, porque o efeito de busca só
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
    // O nome era `relatorio-today-…`, a chave crua do backend. Agora descreve
    // o recorte em português, e a data é a de São Paulo (ver exportMetricsCsv).
    expect(anchor.download).toMatch(/^relatorio-ultimas-24-horas-\d{4}-\d{2}-\d{2}\.csv$/);
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

// Etapa 6.3 — trocar de periodo mudava o rotulo na hora e os numeros so depois.
// A tela chegava a afirmar "Ultimos 30 dias" sobre os numeros das ultimas 24h.
describe('troca de periodo e atomica', () => {
  const HOJE = { period: 'today', scope: 'agent', own: { closedCount: 3, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 } };
  const TRINTA = { period: '30d', scope: 'agent', own: { closedCount: 88, avgResolutionMinutes: 20, avgFirstResponseMinutes: 5 } };

  test('enquanto a resposta nova nao chega, rotulo e numeros continuam sendo os antigos', async () => {
    let liberar;
    api.getMetrics
      .mockResolvedValueOnce(HOJE)
      .mockReturnValueOnce(new Promise((resolve) => { liberar = () => resolve(TRINTA); }));
    renderPage();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByLabelText('Resumo do período')).toHaveTextContent(/últimas 24 horas/i);

    await userEvent.click(screen.getByRole('button', { name: /últimos 30 dias/i }));

    // O rótulo do resumo ainda descreve os dados que estão na tela.
    const resumo = screen.getByLabelText('Resumo do período');
    expect(resumo).toHaveTextContent(/últimas 24 horas/i);
    expect(resumo).not.toHaveTextContent(/últimos 30 dias/i);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('88')).not.toBeInTheDocument();
    // E a tela diz que está buscando, em vez de fingir que já trocou.
    expect(screen.getByText(/atualizando/i)).toBeInTheDocument();

    liberar();

    // Dados e rótulo entram juntos.
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    expect(resumo).toHaveTextContent(/últimos 30 dias/i);
    expect(resumo).not.toHaveTextContent(/últimas 24 horas/i);
    expect(screen.queryByText(/atualizando/i)).not.toBeInTheDocument();
  });

  test('a primeira carga nao mostra "atualizando", mostra o carregamento normal', () => {
    api.getMetrics.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText(/carregando indicadores/i)).toBeInTheDocument();
    expect(screen.queryByText(/atualizando/i)).not.toBeInTheDocument();
  });

  test('resposta atrasada de um periodo abandonado nao sobrescreve o periodo atual', async () => {
    let liberarAntiga;
    api.getMetrics
      .mockReturnValueOnce(new Promise((resolve) => { liberarAntiga = () => resolve(HOJE); }))
      .mockResolvedValueOnce(TRINTA);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /últimos 30 dias/i }));
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());

    liberarAntiga();

    await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toHaveTextContent(/últimos 30 dias/i));
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  test('periodo personalizado rotula com o numero de dias que produziu os dados', async () => {
    api.getMetrics
      .mockResolvedValueOnce(HOJE)
      .mockResolvedValueOnce({ ...TRINTA, period: 'custom' });
    renderPage();
    await screen.findByText('3');

    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    await userEvent.type(screen.getByLabelText(/últimos/i), '45');
    await userEvent.click(screen.getByRole('button', { name: /aplicar/i }));

    await waitFor(() => expect(screen.getByLabelText('Resumo do período')).toHaveTextContent(/últimos 45 dias/i));
  });
});

// Etapa 6.4 — o campo "Personalizado" abria vazio mesmo com ?dias=45 em vigor,
// e o painel ficava aberto depois de aplicar.
describe('campo de periodo personalizado', () => {
  const DADOS = { period: 'custom', scope: 'agent', own: { closedCount: 9, avgResolutionMinutes: 5, avgFirstResponseMinutes: 2 } };

  test('abre mostrando os dias que ja estao em vigor na URL', async () => {
    api.getMetrics.mockResolvedValue(DADOS);
    renderInShell(<ReportsPage />, { path: '/relatorios', initialEntries: ['/relatorios?periodo=custom&dias=45'] });
    await screen.findByText('9');

    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));

    expect(screen.getByLabelText(/últimos/i)).toHaveValue(45);
  });

  test('aplicar fecha o painel', async () => {
    api.getMetrics.mockResolvedValue(DADOS);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    await userEvent.type(screen.getByLabelText(/últimos/i), '45');

    await userEvent.click(screen.getByRole('button', { name: /aplicar/i }));

    await waitFor(() => expect(screen.queryByLabelText(/últimos/i)).not.toBeInTheDocument());
  });

  test('exporta com o numero de dias do request que produziu os dados', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function noop() {});
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    api.getMetrics.mockResolvedValue(DADOS);
    renderInShell(<ReportsPage />, { path: '/relatorios', initialEntries: ['/relatorios?periodo=custom&dias=45'] });
    await screen.findByText('9');

    await userEvent.click(screen.getByRole('button', { name: /exportar csv/i }));

    expect(clickSpy.mock.instances[0].download).toMatch(/^relatorio-ultimos-45-dias-\d{4}-\d{2}-\d{2}\.csv$/);
    clickSpy.mockRestore();
  });
});

// Redesign de Relatórios: a lista da equipe passou a ser o centro da tela e
// precisa continuar legível com quase 20 atendentes.
describe('desempenho da equipe no painel', () => {
  function admin(byAgent, bySector = [], byReason = []) {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({ period: 'today', scope: 'admin', byAgent, bySector, byReason });
  }
  function atendente(agentId, agentName, closedCount, avgResolutionMinutes = 10, avgFirstResponseMinutes = 2) {
    return { agentId, agentName, closedCount, avgResolutionMinutes, avgFirstResponseMinutes };
  }

  test('mostra só o primeiro nome do atendente', async () => {
    admin([atendente('a1', 'Gabriela Reis Menezes', 5)]);
    renderPage();

    expect(await screen.findByRole('rowheader', { name: 'Gabriela' })).toBeInTheDocument();
    expect(screen.queryByText('Gabriela Reis Menezes')).not.toBeInTheDocument();
  });

  test('desempata primeiros nomes iguais com o mínimo necessário', async () => {
    admin([atendente('a1', 'Ana Paula Pereira', 5), atendente('a2', 'Ana Carolina Souza', 3)]);
    renderPage();

    expect(await screen.findByRole('rowheader', { name: 'Ana P.' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Ana S.' })).toBeInTheDocument();
  });

  test('ordena por atendimentos por padrão, do maior para o menor', async () => {
    admin([atendente('a1', 'Bruno Lima', 4), atendente('a2', 'Carla Dias', 9), atendente('a3', 'Ari Melo', 6)]);
    renderPage();

    await screen.findByRole('rowheader', { name: 'Carla' });
    const nomes = screen.getAllByRole('rowheader').map((celula) => celula.textContent);
    // A posição (1, 2, 3) e a inicial do avatar ficam na mesma célula, fora do
    // nome acessível — por isso a leitura aqui é pelo texto bruto.
    expect(nomes).toEqual(['1CCarla', '2AAri', '3BBruno']);
  });

  test('trocar a ordenação reordena a lista sem buscar de novo', async () => {
    admin([
      atendente('a1', 'Bruno Lima', 9, 90),
      atendente('a2', 'Carla Dias', 4, 12),
    ]);
    renderPage();
    await screen.findByRole('rowheader', { name: 'Bruno' });

    await userEvent.selectOptions(screen.getByRole('combobox'), 'resolution');

    expect(screen.getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['1CCarla', '2BBruno']);
    expect(api.getMetrics).toHaveBeenCalledTimes(1);
  });

  test('atendente sem média vai para o fim ao ordenar por tempo', async () => {
    admin([atendente('a1', 'Bruno Lima', 9, null), atendente('a2', 'Carla Dias', 4, 30)]);
    renderPage();
    await screen.findByRole('rowheader', { name: 'Bruno' });

    await userEvent.selectOptions(screen.getByRole('combobox'), 'resolution');

    expect(screen.getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['1CCarla', '2BBruno']);
  });

  test('com mais de dez atendentes a lista abre resumida e o botão revela o resto', async () => {
    const equipe = Array.from({ length: 14 }, (_, i) => atendente(`a${i}`, `Atendente${String.fromCharCode(65 + i)} Silva`, 20 - i));
    admin(equipe);
    renderPage();

    await screen.findByRole('rowheader', { name: 'AtendenteA' });
    expect(screen.getAllByRole('rowheader')).toHaveLength(10);

    await userEvent.click(screen.getByRole('button', { name: /ver todos os atendentes \(14\)/i }));

    expect(screen.getAllByRole('rowheader')).toHaveLength(14);
  });

  test('com dez atendentes ou menos não existe botão de expandir', async () => {
    admin([atendente('a1', 'Ana Souza', 5)]);
    renderPage();

    await screen.findByRole('rowheader', { name: 'Ana' });
    expect(screen.queryByRole('button', { name: /ver todos os atendentes/i })).not.toBeInTheDocument();
  });

  test('o indicador de atendentes conta quem teve encerramento no período', async () => {
    admin([atendente('a1', 'Ana Souza', 5), atendente('a2', 'Bruno Lima', 3)]);
    renderPage();

    await screen.findByRole('rowheader', { name: 'Ana' });
    const resumo = screen.getByLabelText('Resumo do período');
    expect(resumo).toHaveTextContent('Atendentes no período');
    expect(resumo).toHaveTextContent('8'); // 5 + 3 encerrados
    expect(resumo).toHaveTextContent('2'); // dois atendentes
  });
});

describe('setores e motivos como cartões do painel', () => {
  function admin(bySector, byReason = []) {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today',
      scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana Souza', closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 }],
      bySector,
      byReason,
    });
  }

  test('mostra a participação de cada setor sobre o total do próprio cartão', async () => {
    admin([
      { sectorId: 's1', sectorName: 'Financeiro', closedCount: 75 },
      { sectorId: 's2', sectorName: 'Suporte', closedCount: 25 },
    ]);
    renderPage();

    const setores = await screen.findByLabelText('Atendimentos por setor');
    expect(setores).toHaveTextContent('75%');
    expect(setores).toHaveTextContent('25%');
  });

  test('ordena as fatias da maior para a menor', async () => {
    admin([
      { sectorId: 's1', sectorName: 'Comercial', closedCount: 2 },
      { sectorId: null, sectorName: 'Sem setor', closedCount: 40 },
      { sectorId: 's2', sectorName: 'Suporte', closedCount: 8 },
    ]);
    renderPage();

    const setores = await screen.findByLabelText('Atendimentos por setor');
    const nomes = [...setores.querySelectorAll('.report-distribution-name')].map((n) => n.textContent);
    expect(nomes).toEqual(['Sem setor', 'Suporte', 'Comercial']);
  });

  test('acima de oito motivos o cartão resume e oferece ver todos', async () => {
    admin(
      [],
      Array.from({ length: 11 }, (_, i) => ({ reasonId: `r${i}`, reasonName: `Motivo ${i}`, closedCount: 11 - i }))
    );
    renderPage();

    const motivos = await screen.findByLabelText('Motivos de contato');
    expect(motivos.querySelectorAll('.report-distribution li')).toHaveLength(8);

    await userEvent.click(screen.getByRole('button', { name: /ver todos \(11\)/i }));

    expect(motivos.querySelectorAll('.report-distribution li')).toHaveLength(11);
  });
});
