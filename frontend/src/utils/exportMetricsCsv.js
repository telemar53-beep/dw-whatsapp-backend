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

// Fuso de São Paulo, sempre. O nome do arquivo e a hora de geração são lidos
// como data local por quem baixa; `toISOString` é UTC e, depois das 21h, já
// datava o relatório do dia seguinte.
const FUSO = 'America/Sao_Paulo';

function partes(agora, opcoes) {
  const formatador = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes });
  return Object.fromEntries(formatador.formatToParts(agora).map((p) => [p.type, p.value]));
}

export function dataEmSaoPaulo(agora) {
  const p = partes(agora, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

export function momentoEmSaoPaulo(agora) {
  const p = partes(agora, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const NOME_DO_PERIODO = { today: 'ultimas-24-horas', '7d': 'ultimos-7-dias', '30d': 'ultimos-30-dias' };

// Recebe o instantâneo que produziu os dados exportados, nunca a seleção atual:
// com uma requisição em andamento, as duas coisas divergem.
export function nomeDoArquivoDeMetricas({ period, customDays }, agora) {
  const trecho = period === 'custom' ? `ultimos-${customDays}-dias` : NOME_DO_PERIODO[period] || period;
  return `relatorio-${trecho}-${dataEmSaoPaulo(agora)}.csv`;
}

// `meta` ({ periodo, geradoEm }) vira duas linhas antes da tabela: sem elas o
// arquivo aberto no Excel não dizia de que recorte ele era.
export function buildMetricsCsv(data, meta) {
  const corpo = data.scope === 'agent' ? agentRows(data) : adminRows(data);
  const rows = meta
    ? [['Período do relatório', meta.periodo], ['Gerado em', momentoEmSaoPaulo(meta.geradoEm)], [], ...corpo]
    : corpo;
  return rows.map(rowToLine).join('\r\n');
}
