import { describe, test, expect } from 'vitest';
import { buildMetricsCsv } from './exportMetricsCsv';

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
