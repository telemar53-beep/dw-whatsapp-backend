import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';
import { buildMetricsCsv, nomeDoArquivoDeMetricas } from '../utils/exportMetricsCsv';
import { formatDuration } from '../utils/formatDuration';
import SectionHelp from '../components/SectionHelp';
import './reports.css';

const PERIODS = [
  { value: 'today', label: 'Últimas 24 horas' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];
function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconClock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

function IconReply(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M9 10l-4 4 4 4" />
      <path d="M5 14h9a5 5 0 0 0 5-5V7" />
    </svg>
  );
}

function IconUsers(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.5c1.5.4 2.5 1.7 2.5 3.2s-1 2.8-2.5 3.2" />
      <path d="M18 14.2c1.8.5 3 2 3 3.8" />
    </svg>
  );
}

function IconLayers(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" />
      <path d="M4 12l8 4.5 8-4.5" />
      <path d="M4 16.5L12 21l8-4.5" />
    </svg>
  );
}

function IconInbox(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 12h4l2 3h4l2-3h4" />
      <path d="M6 5h12l2 7v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6l2-7z" />
    </svg>
  );
}

function IconAlert(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 4.3l-8 14A1.7 1.7 0 0 0 3.7 21h16.6a1.7 1.7 0 0 0 1.4-2.7l-8-14a1.7 1.7 0 0 0-2.8 0z" />
    </svg>
  );
}

function IconDownload(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function IconTag(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2l9 9-9 9-9-9V2h9z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}


function IconCalendar() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/></svg>; }
function Metric({ icon, value, label }) { return <div className="report-metric"><span className="report-metric-icon">{icon}</span><div><strong>{value ?? '—'}</strong><span>{label}</span></div></div>; }
function EmptyState() { return <p className="report-empty"><IconInbox />Nenhum atendimento fechado nesse período.</p>; }
// Escala visual apenas: os valores e os cálculos do relatório permanecem intactos.
function VolumeBar({ value, maximum }) { return <span className="report-bar" aria-hidden="true"><span style={{ width: maximum > 0 ? (value / maximum * 100) + '%' : '0%' }} /></span>; }
function Breakdown({ title, icon, rows, nameKey, idKey, note, unsetNote }) {
  const maximum = Math.max(0, ...rows.map(row => row.closedCount));
  return <section className="report-breakdown" aria-label={title}>
    <header className="report-section-heading"><span>{icon}<h2>{title}</h2></span><small>{note}</small></header>
    {rows.length === 0 ? <EmptyState /> : <ul className="report-distribution">{rows.map(row => <li key={row[idKey] ?? 'none'} className={row[idKey] === null ? 'report-unset' : ''}>
      <div><span>{row[nameKey]}</span><strong>{row.closedCount}</strong></div><VolumeBar value={row.closedCount} maximum={maximum}/>
    </li>)}</ul>}
    {rows.some(row => row[idKey] === null) && <p className="report-note">{unsetNote}</p>}
  </section>;
}
// A faixa de indicadores do admin sai do mesmo payload dos gráficos: total de
// fechados e as médias de tempo ponderadas pelo volume de cada atendente.
function summarize(byAgent) {
  const closedCount = byAgent.reduce((total, row) => total + (row.closedCount || 0), 0);

  function weightedAverage(field) {
    const rows = byAgent.filter((row) => row[field] !== null && row[field] !== undefined && row.closedCount > 0);
    const weight = rows.reduce((total, row) => total + row.closedCount, 0);
    if (weight === 0) return null;
    const sum = rows.reduce((total, row) => total + row[field] * row.closedCount, 0);
    return Math.round((sum / weight) * 10) / 10;
  }

  return {
    closedCount,
    avgResolutionMinutes: weightedAverage('avgResolutionMinutes'),
    avgFirstResponseMinutes: weightedAverage('avgFirstResponseMinutes'),
  };
}

const CUSTOM_DAYS_MAX = 365;
const PERIOD_VALUES = ['today', '7d', '30d', 'custom'];

function isValidCustomDays(value) {
  return Number.isInteger(value) && value >= 1 && value <= CUSTOM_DAYS_MAX;
}

// Sempre a partir do instantâneo da resposta, nunca da seleção atual: é o
// período dos números que estão na tela.
function rotuloDoPeriodo({ period, customDays }) {
  if (period === 'custom') return `Últimos ${customDays} dias`;
  return PERIODS.find((p) => p.value === period)?.label;
}

function ReportsPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPeriod = PERIOD_VALUES.includes(searchParams.get('periodo')) ? searchParams.get('periodo') : 'today';
  const customDaysFromUrl = Number(searchParams.get('dias'));
  const validCustomDaysFromUrl = isValidCustomDays(customDaysFromUrl) ? customDaysFromUrl : null;
  // periodo=custom sem "dias" válido (1..365) não tem o que buscar — em vez
  // de ficar preso em "Carregando indicadores…" pra sempre, cai para "today".
  const period = rawPeriod === 'custom' && !validCustomDaysFromUrl ? 'today' : rawPeriod;
  const customDays = period === 'custom' ? validCustomDaysFromUrl : null;
  // Abrir "Personalizado" com ?dias=45 na URL mostrava o campo vazio, como se
  // o recorte em vigor não existisse.
  const [customDaysInput, setCustomDaysInput] = useState(validCustomDaysFromUrl ? String(validCustomDaysFromUrl) : '');
  const [showCustomInput, setShowCustomInput] = useState(false);
  // A resposta carrega junto os parâmetros que a produziram. Antes o rótulo do
  // resumo lia a seleção atual: trocar de período mudava o texto na hora e os
  // números só depois, então a tela afirmava "Últimos 30 dias" sobre os números
  // das últimas 24 horas. Dados e rótulo agora entram e saem juntos, e é esse
  // instantâneo — não a seleção — que nomeia a exportação.
  const [resposta, setResposta] = useState(null);
  const [error, setError] = useState(null);
  const [atualizando, setAtualizando] = useState(false);
  const data = resposta ? resposta.dados : null;

  function selectPeriod(value, days) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('periodo', value);
      if (value === 'custom' && days) next.set('dias', String(days)); else next.delete('dias');
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setAtualizando(true);
    getMetrics(period, token, customDays)
      .then((dados) => {
        if (cancelado) return;
        setResposta({ dados, period, customDays });
        setAtualizando(false);
      })
      .catch(() => {
        if (cancelado) return;
        setError('Falha ao carregar métricas');
        setAtualizando(false);
      });
    // Uma resposta atrasada de um período abandonado não pode chegar depois e
    // sobrescrever a do período que o usuário está vendo.
    return () => { cancelado = true; };
  }, [period, token, customDays]);

  const customDaysValue = Number(customDaysInput);
  const customDaysValid = isValidCustomDays(customDaysValue);

  function handleApplyCustomDays() {
    if (!customDaysValid) return;
    selectPeriod('custom', customDaysValue);
    setShowCustomInput(false);
  }

  function handleExportCsv() {
    if (!resposta) return;
    // Tudo sai do instantâneo: se há uma requisição em andamento, o arquivo
    // descreve os dados que foram exportados, não o período já selecionado.
    const agora = new Date();
    const csv = buildMetricsCsv(resposta.dados, { periodo: rotuloDoPeriodo(resposta), geradoEm: agora });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeDoArquivoDeMetricas(resposta, agora);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const isAdmin = data && data.scope === 'admin';
  const summary = useMemo(() => (isAdmin ? summarize(data.byAgent) : null), [isAdmin, data]);


  const adminHasNoBreakdown = isAdmin && data.byAgent.length === 0 && data.bySector.length === 0 && data.byReason.length === 0;
  const maximumVolume = isAdmin ? Math.max(0, ...data.byAgent.map(row => row.closedCount)) : 0;
  const metrics = isAdmin ? summary : data?.scope === 'agent' ? data.own : null;
  return <div className="reports-workspace reports-redesign">
    <header className="report-toolbar">
      <div className="report-title"><h1>Relatórios</h1>{data && <span className="report-scope"><IconUsers/>{isAdmin ? 'Equipe' : 'Meus resultados'}</span>}</div>
      <div className="report-periods" role="group" aria-label="Período do relatório"><IconCalendar/>
        {PERIODS.map(p => <button key={p.value} type="button" aria-pressed={period === p.value} onClick={() => { selectPeriod(p.value); setShowCustomInput(false); }}>{p.label}</button>)}
        <button type="button" aria-pressed={period === 'custom'} aria-expanded={showCustomInput} onClick={() => setShowCustomInput(prev => !prev)}>Personalizado</button>
      </div>
      <button className="report-export" type="button" onClick={handleExportCsv} disabled={!data}><IconDownload/>Exportar CSV</button>
      {showCustomInput && <div className="report-custom-period"><label htmlFor="custom-days">Últimos</label><input id="custom-days" type="number" min="1" max={CUSTOM_DAYS_MAX} value={customDaysInput} onChange={e => setCustomDaysInput(e.target.value)}/><span>dias</span><button type="button" onClick={handleApplyCustomDays} disabled={!customDaysValid}>Aplicar</button><span className="report-note">De 1 a 365 dias</span></div>}
    </header>
    <div className={`report-content chat-scroll${atualizando && resposta ? ' is-atualizando' : ''}`}>
      {error && <div role="alert" className="report-error"><IconAlert/>{error}</div>}
      {!data && !error && <p role="status" aria-live="polite" className="report-empty">Carregando indicadores…</p>}
      <section className="report-overview" aria-label="Resumo do período">
        <div className="report-overview-heading"><span>Resumo do período{resposta && <>{' '}<b>· {rotuloDoPeriodo(resposta)}</b></>}{atualizando && resposta && <em className="report-updating" role="status">Atualizando…</em>}</span><div className="report-help"><span aria-hidden="true">ⓘ</span>          <SectionHelp label="Como os tempos são calculados" title="Como os tempos são calculados">
            <p>
              <strong>Tempo médio de atendimento</strong> começa quando a conversa é criada e termina no encerramento.
              Inclui o tempo em espera, na triagem e com a IA, e as transferências.
            </p>
            <p className="mt-2">
              <strong>Tempo médio de primeira resposta</strong> vai da criação da conversa até a primeira mensagem do
              atendente depois de assumir. Conversas em que o atendente não respondeu não entram nessa média.
            </p>
            <p className="mt-2">
              Os dois números da equipe são médias ponderadas pelo total de atendimentos fechados de cada atendente.
              O CSV exporta os valores em minutos.
            </p>
            <p className="mt-2">
              Motivos de contato inclui também os atendimentos encerrados pela IA; os totais e o gráfico por setor
              contam só os encerrados por atendentes.
            </p>
          </SectionHelp></div></div>
        {metrics && <div className="report-metrics">
          <Metric icon={<IconCheck/>} value={metrics.closedCount} label="Atendimentos fechados"/>
          <Metric icon={<IconClock/>} value={formatDuration(metrics.avgResolutionMinutes)} label="Tempo médio de atendimento"/>
          <Metric icon={<IconReply/>} value={formatDuration(metrics.avgFirstResponseMinutes)} label="Tempo médio de primeira resposta"/>
        </div>}
      </section>
      {isAdmin && (adminHasNoBreakdown ? <section className="report-no-data" aria-label="Relatórios sem dados"><EmptyState/><p>Os indicadores por atendente, setor, motivo e tempo aparecem quando houver atendimentos encerrados no período selecionado.</p></section> : <div className="report-analysis">
        <section className="report-team" aria-labelledby="report-team-title">
          <header className="report-section-heading"><span><IconUsers/><h2 id="report-team-title">Desempenho da equipe</h2></span><small>Encerramentos por atendentes</small></header>
          {data.byAgent.length === 0 ? <EmptyState/> : <table className="report-team-table">
            <caption className="sr-only">Atendimentos encerrados e tempos médios por atendente</caption>
            <thead><tr><th scope="col">Atendente</th><th scope="col">Encerrados</th><th scope="col">Tempo médio<br/>de atendimento</th><th scope="col">Primeira<br/>resposta</th></tr></thead>
            <tbody>{data.byAgent.map(row => <tr key={row.agentId ?? row.agentName}>
              <th scope="row"><span className="report-person"><span className="report-avatar" aria-hidden="true">{row.agentName?.trim().slice(0,2).toUpperCase()}</span><span>{row.agentName}</span></span></th>
              <td data-label="Encerrados"><div className="report-volume"><strong>{row.closedCount}</strong><VolumeBar value={row.closedCount} maximum={maximumVolume}/></div></td>
              <td data-label="Tempo de atendimento">{formatDuration(row.avgResolutionMinutes)}</td>
              <td data-label="Primeira resposta">{formatDuration(row.avgFirstResponseMinutes)}</td>
            </tr>)}</tbody>
          </table>}
          <p className="report-note report-team-note">Os tempos são médias. “—” indica ausência de dados para o cálculo.</p>
        </section>
        <aside className="report-breakdowns" aria-label="Distribuição dos atendimentos">
          <Breakdown title="Atendimentos por setor" icon={<IconLayers/>} rows={data.bySector} nameKey="sectorName" idKey="sectorId" note="Encerrados por atendentes" unsetNote={'"Sem setor" são conversas encerradas sem setor definido na triagem ou pelo atendente.'}/>
          <Breakdown title="Motivos de contato" icon={<IconTag/>} rows={data.byReason} nameKey="reasonName" idKey="reasonId" note="Inclui encerramentos pela IA" unsetNote={'"Sem motivo" são conversas finalizadas direto da fila, sem motivo.'}/>
        </aside>
      </div>)}
    </div>
  </div>;
}
export default ReportsPage;
