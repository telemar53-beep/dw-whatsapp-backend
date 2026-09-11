function formatNumber(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace('.', ',');
}

function escapeField(value) {
  const text = String(value);
  if (/[;"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowToLine(row) {
  return row.map(escapeField).join(';');
}

function agentRows(data) {
  return [
    ['Atendimentos fechados', 'Tempo médio de atendimento (min)', 'Tempo médio de primeira resposta (min)'],
    [data.own.closedCount, formatNumber(data.own.avgResolutionMinutes), formatNumber(data.own.avgFirstResponseMinutes)],
  ];
}

function adminRows(data) {
  const rows = [];

  rows.push(['Atendimentos por atendente']);
  rows.push(['Atendente', 'Atendimentos fechados', 'Tempo médio de atendimento (min)', 'Tempo médio de primeira resposta (min)']);
  data.byAgent.forEach((row) => {
    rows.push([row.agentName, row.closedCount, formatNumber(row.avgResolutionMinutes), formatNumber(row.avgFirstResponseMinutes)]);
  });
  rows.push([]);

  rows.push(['Atendimentos por setor']);
  rows.push(['Setor', 'Atendimentos fechados']);
  data.bySector.forEach((row) => rows.push([row.sectorName, row.closedCount]));
  rows.push([]);

  rows.push(['Motivos de contato']);
  rows.push(['Motivo', 'Atendimentos fechados']);
  data.byReason.forEach((row) => rows.push([row.reasonName, row.closedCount]));

  return rows;
}

export function buildMetricsCsv(data) {
  const rows = data.scope === 'agent' ? agentRows(data) : adminRows(data);
  return rows.map(rowToLine).join('\r\n');
}
