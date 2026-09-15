import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';
import { buildMetricsCsv } from '../utils/exportMetricsCsv';
import { formatDuration } from '../utils/formatDuration';
import { PageHeader, Button } from '../components/ui';
import SectionHelp from '../components/SectionHelp';

const PERIODS = [
  { value: 'today', label: 'Últimas 24 horas' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

// Séries claras o bastante para o fundo escuro, e distintas entre si.
const TEAL = '#4dd4ac';
const AMBER_DARK = '#f0a94f';
const INDIGO = '#8aa9e8';
// Barras "Sem setor" / "Sem motivo": neutro, fora da paleta das séries normais.
const UNSET = '#9a948f';
const GRID_COLOR = 'rgba(255, 255, 255, 0.10)';
const AXIS_COLOR = 'rgba(255, 255, 255, 0.55)';
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(36, 32, 30, 0.96)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 14,
  boxShadow: '0 30px 80px -20px rgba(0, 0, 0, 0.75)',
  fontSize: 13,
  color: '#f4f1ed',
};
const AXIS_TICK = { fill: AXIS_COLOR, fontSize: 12 };
const CHART_CURSOR = { fill: 'rgba(255, 255, 255, 0.06)' };

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

function IconGauge(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l4-4" />
      <path d="M12 14v.01" />
    </svg>
  );
}

function IconInbox(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
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

const PANEL_CLASS = 'rounded-[22px] border border-white/[0.07] bg-white/[0.08] backdrop-blur-2xl';

function StatTile({ icon, value, label }) {
  const display = value === null || value === undefined ? '—' : value;
  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.07] text-chat-orange">
        {icon}
      </span>
      <p className="font-display text-[32px] font-semibold leading-tight text-chat-text">{display}</p>
      <p className="mt-1.5 text-[14px] leading-[19px] text-chat-muted">{label}</p>
    </div>
  );
}

function ChartCard({ title, icon, children }) {
  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.07] text-chat-orange">
          {icon}
        </span>
        <h2 className="font-display text-[16px] font-semibold text-chat-text">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-white/[0.12] text-center">
      <IconInbox className="h-6 w-6 text-chat-faint" />
      <p className="text-[13.5px] text-chat-faint">Nenhum atendimento fechado nesse período.</p>
    </div>
  );
}

// Eixos e grade repetidos em todos os gráficos.
function chartAxes(dataKey, { yTickFormatter, yWidth = 32 } = {}) {
  return (
    <>
      <CartesianGrid vertical={false} stroke={GRID_COLOR} />
      <XAxis dataKey={dataKey} tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
      <YAxis
        tick={AXIS_TICK}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
        width={yWidth}
        tickFormatter={yTickFormatter}
      />
    </>
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

function ReportsPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const period = PERIOD_VALUES.includes(searchParams.get('periodo')) ? searchParams.get('periodo') : 'today';
  const customDays = period === 'custom' ? Number(searchParams.get('dias')) || null : null;
  const [customDaysInput, setCustomDaysInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  function selectPeriod(value, days) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('periodo', value);
      if (value === 'custom' && days) next.set('dias', String(days)); else next.delete('dias');
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (period === 'custom' && !customDays) return;
    setError(null);
    getMetrics(period, token, customDays)
      .then(setData)
      .catch(() => setError('Falha ao carregar métricas'));
  }, [period, token, customDays]);

  const customDaysValue = Number(customDaysInput);
  const customDaysValid = Number.isInteger(customDaysValue) && customDaysValue >= 1 && customDaysValue <= CUSTOM_DAYS_MAX;

  function handleApplyCustomDays() {
    if (!customDaysValid) return;
    selectPeriod('custom', customDaysValue);
  }

  function handleExportCsv() {
    if (!data) return;
    const csv = buildMetricsCsv(data);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-${data.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const isAdmin = data && data.scope === 'admin';
  const summary = useMemo(() => (isAdmin ? summarize(data.byAgent) : null), [isAdmin, data]);

  function periodButtonClass(selected) {
    return `shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
      selected ? 'border-chat-orange/70 text-chat-text' : 'border-white/[0.12] text-chat-muted hover:text-chat-text'
    }`;
  }

  const hasUnsetSector = isAdmin && data.bySector.some((row) => row.sectorId === null);
  const hasUnsetReason = isAdmin && data.byReason.some((row) => row.reasonId === null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Relatórios"
        description="Indicadores de atendimento da equipe"
        action={
          <Button variant="secondary" onClick={handleExportCsv} disabled={!data}>
            <IconDownload className="h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-3 px-2 pb-4">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              selectPeriod(p.value);
              setShowCustomInput(false);
            }}
            className={periodButtonClass(period === p.value)}
          >
            {p.label}
          </button>
        ))}
        <button onClick={() => setShowCustomInput((prev) => !prev)} className={periodButtonClass(period === 'custom')}>
          Personalizado
        </button>

        {showCustomInput && (
          <>
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-white/10" />
            <div className="flex items-center gap-2">
              <label htmlFor="custom-days" className="text-[14px] text-chat-muted">
                Últimos
              </label>
              <input
                id="custom-days"
                type="number"
                min="1"
                max={CUSTOM_DAYS_MAX}
                value={customDaysInput}
                onChange={(e) => setCustomDaysInput(e.target.value)}
                className="h-[40px] w-20 rounded-[12px] border border-white/[0.12] bg-white/[0.06] px-3 text-[14px] text-chat-text outline-none transition focus:border-chat-orange/60"
              />
              <span className="text-[14px] text-chat-muted">dias</span>
              <button
                type="button"
                onClick={handleApplyCustomDays}
                disabled={!customDaysValid}
                className="h-[40px] rounded-[12px] bg-chat-orange px-4 text-[14px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Aplicar
              </button>
            </div>
          </>
        )}

        <div className="ml-auto">
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
          </SectionHelp>
        </div>
      </div>

      <div className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        {error && (
          <div className="flex items-center gap-2 rounded-[14px] bg-wa-error-bg px-4 py-3 text-[14px] text-wa-error-text">
            <IconAlert className="h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {!data && !error && (
          <p className="px-1 py-10 text-center text-[14px] text-chat-faint">Carregando indicadores...</p>
        )}

        {data && data.scope === 'agent' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile icon={<IconCheck className="h-5 w-5" />} value={data.own.closedCount} label="Atendimentos fechados" />
            <StatTile
              icon={<IconClock className="h-5 w-5" />}
              value={formatDuration(data.own.avgResolutionMinutes)}
              label="Tempo médio de atendimento"
            />
            <StatTile
              icon={<IconReply className="h-5 w-5" />}
              value={formatDuration(data.own.avgFirstResponseMinutes)}
              label="Tempo médio de primeira resposta"
            />
          </div>
        )}

        {isAdmin && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile icon={<IconCheck className="h-5 w-5" />} value={summary.closedCount} label="Atendimentos fechados" />
              <StatTile
                icon={<IconClock className="h-5 w-5" />}
                value={formatDuration(summary.avgResolutionMinutes)}
                label="Tempo médio de atendimento"
              />
              <StatTile
                icon={<IconReply className="h-5 w-5" />}
                value={formatDuration(summary.avgFirstResponseMinutes)}
                label="Tempo médio de primeira resposta"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ChartCard title="Atendimentos por atendente" icon={<IconUsers className="h-4 w-4" />}>
                {data.byAgent.length === 0 ? (
                  <EmptyState />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.byAgent} barCategoryGap="32%">
                      {chartAxes('agentName')}
                      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CHART_CURSOR} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="closedCount"
                        name="Atendimentos"
                        fill={TEAL}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard title="Atendimentos por setor" icon={<IconLayers className="h-4 w-4" />}>
                {data.bySector.length === 0 ? (
                  <EmptyState />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={data.bySector} barCategoryGap="32%">
                        {chartAxes('sectorName')}
                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CHART_CURSOR} />
                        <Bar isAnimationActive={false} dataKey="closedCount" name="Atendimentos" radius={[6, 6, 0, 0]} maxBarSize={48}>
                          {data.bySector.map((row) => (
                            <Cell key={row.sectorId ?? 'none'} fill={row.sectorId === null ? UNSET : INDIGO} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {hasUnsetSector && (
                      <p className="mt-2 text-[12.5px] text-chat-faint">
                        "Sem setor" são conversas encerradas sem setor definido na triagem ou pelo atendente.
                      </p>
                    )}
                  </>
                )}
              </ChartCard>

              <ChartCard title="Motivos de contato" icon={<IconTag className="h-4 w-4" />}>
                {data.byReason.length === 0 ? (
                  <EmptyState />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={data.byReason} barCategoryGap="32%">
                        {chartAxes('reasonName')}
                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CHART_CURSOR} />
                        <Bar isAnimationActive={false} dataKey="closedCount" name="Atendimentos" radius={[6, 6, 0, 0]} maxBarSize={48}>
                          {data.byReason.map((row) => (
                            <Cell key={row.reasonId ?? 'none'} fill={row.reasonId === null ? UNSET : AMBER_DARK} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {hasUnsetReason && (
                      <p className="mt-2 text-[12.5px] text-chat-faint">
                        "Sem motivo" são conversas finalizadas direto da fila, sem motivo.
                      </p>
                    )}
                  </>
                )}
              </ChartCard>

              <ChartCard title="Tempo médio por atendente" icon={<IconGauge className="h-4 w-4" />}>
                {data.byAgent.length === 0 ? (
                  <EmptyState />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.byAgent} barCategoryGap="28%" barGap={4}>
                      {chartAxes('agentName', { yTickFormatter: (v) => `${v} min`, yWidth: 56 })}
                      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CHART_CURSOR} />
                      <Legend wrapperStyle={{ fontSize: 13, color: AXIS_COLOR, paddingTop: 8 }} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="avgResolutionMinutes"
                        name="Atendimento"
                        fill={TEAL}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      />
                      <Bar
                        isAnimationActive={false}
                        dataKey="avgFirstResponseMinutes"
                        name="Primeira resposta"
                        fill={AMBER_DARK}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ReportsPage;
