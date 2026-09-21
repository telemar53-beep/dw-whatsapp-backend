import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';
import { buildMetricsCsv, nomeDoArquivoDeMetricas } from '../utils/exportMetricsCsv';
import { formatDuration } from '../utils/formatDuration';
import { shortenAgentNames, agentInitial } from '../utils/agentDisplayName';
import SectionHelp from '../components/SectionHelp';
import './reports.css';

const PERIODS = [
  { value: 'today', label: 'Últimas 24 horas' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

function IconConversationCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20 14a3 3 0 0 1-3 3H9l-4 3v-3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />
      <path d="M9 10.5l2 2 4-4" />
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

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 11h18" />
    </svg>
  );
}

function IconChevron(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Cartão de indicador. `tom` dá a cada indicador uma identidade própria —
// laranja, azul, verde, roxo — em borda, halo e superfície do ícone. O fundo
// continua grafite: a cor marca o cartão, não o pinta.
function Kpi({ icon, value, label, note, tom = 'neutro' }) {
  return (
    <article className="report-kpi" data-tom={tom}>
      <span className="report-kpi-icon">{icon}</span>
      <strong className="report-kpi-value">{value ?? '—'}</strong>
      <span className="report-kpi-label">{label}</span>
      <span className="report-kpi-note">{note}</span>
    </article>
  );
}

function EmptyState() {
  return (
    <p className="report-empty">
      <IconInbox />
      Nenhum atendimento fechado nesse período.
    </p>
  );
}

// Escala visual apenas: os valores e os cálculos do relatório permanecem intactos.
// `tom` escolhe um slot fixo da paleta categórica; é diferenciação visual de
// categoria, nunca juízo de desempenho.
function VolumeBar({ value, maximum, variant = '', tom }) {
  return (
    <span className={`report-bar ${variant}`.trim()} data-tom={tom} aria-hidden="true">
      <span style={{ width: maximum > 0 ? (value / maximum) * 100 + '%' : '0%' }} />
    </span>
  );
}

// Oito linhas antes do expansor: é o que a referência mostra e o que a altura
// do cartão comporta com a densidade atual, sem o expansor virar obrigação.
const BREAKDOWN_PREVIEW = 8;
// Seis slots fixos de cor, atribuídos na ordem decrescente do cartão e nunca
// reciclados: da sétima categoria em diante a barra é neutra, como o "Outros"
// da referência. Ausência de setor/motivo não é categoria e também fica neutra,
// sem consumir slot — por isso a contagem anda só nas linhas reais.
const BREAKDOWN_TONES = 6;

function tonsPorLinha(ordenadas, idKey) {
  const tons = new Map();
  let slot = 0;
  ordenadas.forEach((row) => {
    if (row[idKey] === null) return;
    slot += 1;
    if (slot <= BREAKDOWN_TONES) tons.set(row, slot);
  });
  return tons;
}

// Setor e motivo são cartões de painel, não tabelas de apoio: rótulo em cima,
// barra de largura cheia embaixo, número e participação alinhados à direita. A
// participação é aritmética sobre o total do próprio cartão — setor e motivo
// têm totais diferentes de propósito (motivo inclui encerramento pela IA).
function Breakdown({ title, icon, rows, nameKey, idKey, note, unsetNote, tom }) {
  const [expandido, setExpandido] = useState(false);
  const ordenadas = useMemo(() => [...rows].sort((a, b) => b.closedCount - a.closedCount), [rows]);
  const maximum = Math.max(0, ...rows.map((row) => row.closedCount));
  const total = rows.reduce((soma, row) => soma + row.closedCount, 0);
  const visiveis = expandido ? ordenadas : ordenadas.slice(0, BREAKDOWN_PREVIEW);
  const ocultas = ordenadas.length - visiveis.length;
  const tons = useMemo(() => tonsPorLinha(ordenadas, idKey), [ordenadas, idKey]);

  return (
    <section className="report-card report-breakdown" aria-label={title}>
      <header className="report-card-head">
        <div className="report-card-title">
          <span className="report-card-icon" data-tom={tom}>{icon}</span>
          <div>
            <h2>{title}</h2>
            <p>{note}</p>
          </div>
        </div>
      </header>
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="report-distribution">
          {visiveis.map((row) => (
            <li key={row[idKey] ?? 'none'} className={row[idKey] === null ? 'report-unset' : ''}>
              <div className="report-distribution-line">
                <span className="report-distribution-name">{row[nameKey]}</span>
                <strong>{row.closedCount}</strong>
                {total > 0 && <span className="report-share">{Math.round((row.closedCount / total) * 100)}%</span>}
              </div>
              <VolumeBar value={row.closedCount} maximum={maximum} tom={tons.get(row)} />
            </li>
          ))}
        </ul>
      )}
      {(ocultas > 0 || expandido) && ordenadas.length > BREAKDOWN_PREVIEW && (
        <button type="button" className="report-more" aria-expanded={expandido} onClick={() => setExpandido((v) => !v)}>
          {expandido ? 'Mostrar menos' : `Ver todos (${ordenadas.length})`}
          <IconChevron />
        </button>
      )}
      {rows.some((row) => row[idKey] === null) && <p className="report-note">{unsetNote}</p>}
    </section>
  );
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
const TEAM_PREVIEW = 10;

// Menor tempo primeiro; quem não tem média vai para o fim em vez de fingir zero.
function porTempo(a, b) {
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a - b;
}

const SORTS = {
  volume: { label: 'Atendimentos', compare: (a, b) => b.closedCount - a.closedCount },
  resolution: { label: 'Tempo médio', compare: (a, b) => porTempo(a.avgResolutionMinutes, b.avgResolutionMinutes) },
  firstResponse: { label: 'Primeira resposta', compare: (a, b) => porTempo(a.avgFirstResponseMinutes, b.avgFirstResponseMinutes) },
  nome: { label: 'Nome', compare: (a, b) => a.label.localeCompare(b.label, 'pt-BR') },
};

const HORA_LOCAL = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
  // Contador de tentativa: e o que o botao "Tentar de novo" incrementa para o
  // efeito de carga rodar outra vez sem recarregar a pagina.
  const [tentativa, setTentativa] = useState(0);
  const [ordem, setOrdem] = useState('volume');
  const [equipeExpandida, setEquipeExpandida] = useState(false);
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
        setResposta({ dados, period, customDays, carregadoEm: new Date() });
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
  }, [period, token, customDays, tentativa]);

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

  // Primeiro nome só, com o mínimo de desempate quando repete. O rótulo entra
  // na linha antes da ordenação porque "Nome" ordena pelo que está na tela.
  const linhasDaEquipe = useMemo(() => {
    if (!isAdmin) return [];
    const rotulos = shortenAgentNames(data.byAgent.map((row) => row.agentName));
    const linhas = data.byAgent.map((row, i) => ({ ...row, label: rotulos[i] }));
    const compare = (SORTS[ordem] || SORTS.volume).compare;
    return linhas.sort((a, b) => compare(a, b) || a.label.localeCompare(b.label, 'pt-BR'));
  }, [isAdmin, data, ordem]);

  const adminHasNoBreakdown = isAdmin && data.byAgent.length === 0 && data.bySector.length === 0 && data.byReason.length === 0;
  const maximumVolume = isAdmin ? Math.max(0, ...data.byAgent.map((row) => row.closedCount)) : 0;
  const metrics = isAdmin ? summary : data?.scope === 'agent' ? data.own : null;
  const equipeVisivel = equipeExpandida ? linhasDaEquipe : linhasDaEquipe.slice(0, TEAM_PREVIEW);
  const equipeOculta = linhasDaEquipe.length - equipeVisivel.length;

  return <main className="reports-workspace reports-redesign">
    <header className="report-head">
      <div className="report-head-title">
        <div className="report-head-line">
          <h1>Relatórios</h1>
          {data && <span className="report-scope"><IconUsers />{isAdmin ? 'Equipe' : 'Meus resultados'}</span>}
        </div>
        <p>{isAdmin ? 'Compare o desempenho da equipe no período selecionado.' : 'Seus números no período selecionado.'}</p>
      </div>
      <div className="report-head-controls">
        <div className="report-periods" role="group" aria-label="Período do relatório">
          <IconCalendar />
          {PERIODS.map(p => <button key={p.value} type="button" aria-pressed={period === p.value} onClick={() => { selectPeriod(p.value); setShowCustomInput(false); }}>{p.label}</button>)}
          <button type="button" aria-pressed={period === 'custom'} aria-expanded={showCustomInput} onClick={() => setShowCustomInput(prev => !prev)}>Personalizado</button>
        </div>
        <button className="report-export" type="button" onClick={handleExportCsv} disabled={!data}><IconDownload />Exportar CSV</button>
      </div>
      {showCustomInput && <div className="report-custom-period"><label htmlFor="custom-days">Últimos</label><input id="custom-days" type="number" min="1" max={CUSTOM_DAYS_MAX} value={customDaysInput} onChange={e => setCustomDaysInput(e.target.value)} /><span>dias</span><button type="button" onClick={handleApplyCustomDays} disabled={!customDaysValid}>Aplicar</button><span className="report-note">De 1 a 365 dias</span></div>}
    </header>
    <div className={`report-content chat-scroll${atualizando && resposta ? ' is-atualizando' : ''}`}>
      {/* Supervisao e Canais ja ofereciam "Tentar de novo"; aqui a falha era
          um beco sem saida — so recarregar a pagina inteira resolvia. */}
      {error && <div role="alert" className="report-error"><IconAlert /><span>{error}</span><button type="button" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button></div>}
      {!data && !error && <p role="status" aria-live="polite" className="report-empty">Carregando indicadores…</p>}
      <section className="report-overview" aria-label="Resumo do período">
        {resposta && <div className="report-caption">
          <span className="report-caption-period">{rotuloDoPeriodo(resposta)}</span>
          {atualizando && <em className="report-updating" role="status">Atualizando…</em>}
          <div className="report-caption-side">
            <span className="report-snapshot">Atualizado às <time>{HORA_LOCAL.format(resposta.carregadoEm)}</time></span>
            <SectionHelp label="Como os tempos são calculados" title="Como os tempos são calculados">
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
            </SectionHelp>
          </div>
        </div>}
        {metrics && <div className="report-kpis">
          <Kpi tom="laranja" icon={<IconConversationCheck />} value={metrics.closedCount} label="Atendimentos encerrados" note={isAdmin ? 'Encerrados por atendentes' : 'Encerrados por você'} />
          <Kpi tom="azul" icon={<IconClock />} value={formatDuration(metrics.avgResolutionMinutes)} label="Tempo médio de atendimento" note="Da abertura ao encerramento" />
          <Kpi tom="verde" icon={<IconReply />} value={formatDuration(metrics.avgFirstResponseMinutes)} label="Tempo médio de primeira resposta" note="Da abertura à primeira resposta" />
          {isAdmin && <Kpi tom="roxo" icon={<IconUsers />} value={data.byAgent.length} label="Atendentes no período" note="Com ao menos um encerramento" />}
        </div>}
      </section>
      {isAdmin && (adminHasNoBreakdown ? <section className="report-card report-no-data" aria-label="Relatórios sem dados"><EmptyState /><p>Os indicadores por atendente, setor, motivo e tempo aparecem quando houver atendimentos encerrados no período selecionado.</p></section> : <div className="report-analysis">
        <section className="report-card report-team" aria-labelledby="report-team-title">
          <header className="report-card-head">
            <div className="report-card-title">
              <span className="report-card-icon" data-tom="laranja">{<IconUsers />}</span>
              <div>
                <h2 id="report-team-title">Desempenho da equipe</h2>
                <p>Encerramentos e tempos médios por atendente</p>
              </div>
            </div>
            {linhasDaEquipe.length > 1 && <label className="report-sort">
              <span>Ordenar por</span>
              <select value={ordem} onChange={(e) => setOrdem(e.target.value)}>
                {Object.entries(SORTS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>}
          </header>
          {linhasDaEquipe.length === 0 ? <EmptyState /> : <table className="report-team-table">
            <caption className="sr-only">Atendimentos encerrados e tempos médios por atendente</caption>
            <thead><tr><th scope="col">Atendente</th><th scope="col">Atendimentos</th><th scope="col">Tempo médio</th><th scope="col">1ª resposta</th></tr></thead>
            <tbody>{equipeVisivel.map((row, index) => <tr key={row.agentId ?? row.agentName}>
              {/* Posição e inicial ficam fora do nome acessível: quem usa
                  leitor de tela ouve "Gabriela", não "1 G Gabriela". */}
              <th scope="row">
                <span className="report-person">
                  <span className="report-rank" aria-hidden="true" data-lider={ordem === 'volume' && index < 3 ? index + 1 : undefined}>{index + 1}</span>
                  <span className="report-avatar" aria-hidden="true">{agentInitial(row.label)}</span>
                  <span className="report-name">{row.label}</span>
                </span>
              </th>
              {/* O pódio só se pinta quando a lista está ordenada por
                  atendimentos; em "Nome" ou por tempo, a posição não é volume. */}
              <td data-label="Atendimentos"><div className="report-volume"><strong>{row.closedCount}</strong><VolumeBar value={row.closedCount} maximum={maximumVolume} variant={ordem === 'volume' && index < 3 ? `is-podio-${index + 1}` : ''} /></div></td>
              <td data-label="Tempo médio">{formatDuration(row.avgResolutionMinutes)}</td>
              <td data-label="1ª resposta">{formatDuration(row.avgFirstResponseMinutes)}</td>
            </tr>)}</tbody>
          </table>}
          {(equipeOculta > 0 || equipeExpandida) && linhasDaEquipe.length > TEAM_PREVIEW && (
            <button type="button" className="report-more" aria-expanded={equipeExpandida} onClick={() => setEquipeExpandida((v) => !v)}>
              {equipeExpandida ? `Mostrar só os ${TEAM_PREVIEW} primeiros` : `Ver todos os atendentes (${linhasDaEquipe.length})`}
              <IconChevron />
            </button>
          )}
          <p className="report-note report-team-note">Os tempos são médias. “—” indica ausência de dados para o cálculo.</p>
        </section>
        <aside className="report-breakdowns" aria-label="Distribuição dos atendimentos">
          <Breakdown tom="azul" title="Atendimentos por setor" icon={<IconLayers />} rows={data.bySector} nameKey="sectorName" idKey="sectorId" note="Encerrados por atendentes" unsetNote={'"Sem setor" são conversas encerradas sem setor definido na triagem ou pelo atendente.'} />
          <Breakdown tom="roxo" title="Motivos de contato" icon={<IconTag />} rows={data.byReason} nameKey="reasonName" idKey="reasonId" note="Inclui encerramentos pela IA" unsetNote={'"Sem motivo" são conversas finalizadas direto da fila, sem motivo.'} />
        </aside>
      </div>)}
    </div>
  </main>;
}
export default ReportsPage;
