import { describe, test, expect } from 'vitest';
import { buildMetricsCsv, nomeDoArquivoDeMetricas, momentoEmSaoPaulo } from './exportMetricsCsv';

describe('buildMetricsCsv', () => {
  test('builds a single-section CSV for agent scope', () => {
    const csv = buildMetricsCsv({
      scope: 'agent',
      own: { closedCount: 5, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 3 },
    });

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Atendimentos fechados;Tempo médio de atendimento (min);Tempo médio de primeira resposta (min)');
    expect(lines[1]).toBe('5;12,5;3');
  });

  test('renders a null average as an empty field', () => {
    const csv = buildMetricsCsv({
      scope: 'agent',
      own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null },
    });

    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('0;;');
  });

  test('builds three sections for admin scope, in order: by agent, by sector, by reason', () => {
    const csv = buildMetricsCsv({
      scope: 'admin',
      byAgent: [{ agentName: 'Geovanna', closedCount: 10, avgResolutionMinutes: 8, avgFirstResponseMinutes: 1.5 }],
      bySector: [{ sectorName: 'Financeiro', closedCount: 4 }],
      byReason: [{ reasonName: 'Cobrança', closedCount: 2 }],
    });

    const lines = csv.split('\r\n');
    expect(lines).toEqual([
      'Atendimentos por atendente',
      'Atendente;Atendimentos fechados;Tempo médio de atendimento (min);Tempo médio de primeira resposta (min)',
      'Geovanna;10;8;1,5',
      '',
      'Atendimentos por setor',
      'Setor;Atendimentos fechados',
      'Financeiro;4',
      '',
      'Motivos de contato',
      'Motivo;Atendimentos fechados',
      'Cobrança;2',
    ]);
  });

  test('escapes a field containing the delimiter, a quote, or a newline', () => {
    const csv = buildMetricsCsv({
      scope: 'admin',
      byAgent: [{ agentName: 'Carlos; "Apelido"\nTeste', closedCount: 1, avgResolutionMinutes: 1, avgFirstResponseMinutes: 1 }],
      bySector: [],
      byReason: [],
    });

    const lines = csv.split('\r\n');
    expect(lines[2]).toBe('"Carlos; ""Apelido""\nTeste";1;1;1');
  });
});

// Etapa 6.4 — o arquivo nao dizia de que recorte ele era, e a data do nome
// vinha de toISOString (UTC): depois das 21h ja datava o dia seguinte.
describe('cabecalho e nome do arquivo', () => {
  const DADOS = { period: 'today', scope: 'agent', own: { closedCount: 3, avgResolutionMinutes: 12.5, avgFirstResponseMinutes: 4.2 } };

  test('o CSV comeca dizendo o periodo e a hora de geracao', () => {
    const csv = buildMetricsCsv(DADOS, { periodo: 'Últimos 7 dias', geradoEm: new Date('2026-09-21T14:30:00Z') });
    const linhas = csv.split('\r\n');

    expect(linhas[0]).toBe('Período do relatório;Últimos 7 dias');
    expect(linhas[1]).toBe('Gerado em;21/09/2026 11:30');
    expect(linhas[2]).toBe('');
    // A tabela continua igual, logo depois.
    expect(linhas[3]).toBe('Atendimentos fechados;Tempo médio de atendimento (min);Tempo médio de primeira resposta (min)');
  });

  test('sem meta, o arquivo continua sendo so a tabela', () => {
    const csv = buildMetricsCsv(DADOS);
    expect(csv.split('\r\n')[0]).toBe('Atendimentos fechados;Tempo médio de atendimento (min);Tempo médio de primeira resposta (min)');
  });

  test('a data do nome e a de Sao Paulo, nao a de UTC', () => {
    // 21/09 23:30 em Sao Paulo ja e 22/09 em UTC. O arquivo e do dia 21.
    const virada = new Date('2026-09-22T02:30:00Z');
    expect(nomeDoArquivoDeMetricas({ period: '7d' }, virada)).toBe('relatorio-ultimos-7-dias-2026-09-21.csv');
    expect(momentoEmSaoPaulo(virada)).toBe('21/09/2026 23:30');
  });

  test('o nome descreve o recorte em portugues', () => {
    const agora = new Date('2026-09-21T14:00:00Z');
    expect(nomeDoArquivoDeMetricas({ period: 'today' }, agora)).toBe('relatorio-ultimas-24-horas-2026-09-21.csv');
    expect(nomeDoArquivoDeMetricas({ period: '30d' }, agora)).toBe('relatorio-ultimos-30-dias-2026-09-21.csv');
  });

  test('periodo personalizado leva o numero de dias que produziu os dados', () => {
    const agora = new Date('2026-09-21T14:00:00Z');
    expect(nomeDoArquivoDeMetricas({ period: 'custom', customDays: 45 }, agora)).toBe('relatorio-ultimos-45-dias-2026-09-21.csv');
  });
});
