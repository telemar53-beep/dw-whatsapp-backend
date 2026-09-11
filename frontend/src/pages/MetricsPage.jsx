import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';

const PERIODS = [
  { value: 'today', label: 'Últimas 24 horas' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

// Séries claras o bastante para o fundo escuro, e distintas entre si.
const TEAL = '#4dd4ac';
const AMBER_DARK = '#f0a94f';
const INDIGO = '#8aa9e8';
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

function IconChevronLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

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

function IconTag(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2l9 9-9 9-9-9V2h9z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StatTile({ icon, value, label }) {
  const display = value === null || value === undefined ? '-' : value;
  return (
    <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.06] p-6">
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
    <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.06] p-6">
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

const CUSTOM_DAYS_MAX = 365;

function MetricsPage() {
  const { token, agent } = useAuth();
  const [period, setPeriod] = useState('today');
  const [customDays, setCustomDays] = useState(null);
  const [customDaysInput, setCustomDaysInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

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
    setCustomDays(customDaysValue);
    setPeriod('custom');
  }

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[36%] -top-[12%] h-[38rem] w-[42rem] rounded-full bg-chat-copper/40 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[8%] bottom-[-18%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/25 blur-[150px]"
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
      <NavRail active="metrics" onProfileClick={() => setProfileOpen(true)} />
      <div className="chat-scroll min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[22px] border border-white/[0.07] bg-white/[0.08] backdrop-blur-2xl">

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
              Relatório
            </h1>
            <p className="mt-1.5 text-[14px] text-chat-muted">Indicadores de atendimento da equipe</p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-[14px] font-medium text-chat-muted transition hover:bg-white/[0.10] hover:text-chat-text"
          >
            <IconChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setPeriod(p.value);
                  setShowCustomInput(false);
                }}
                className={`shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition ${
                  period === p.value
                    ? 'border-chat-orange/70 text-chat-text'
                    : 'border-white/[0.12] text-chat-muted hover:text-chat-text'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setShowCustomInput((prev) => !prev)}
              className={`shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition ${
                period === 'custom'
                  ? 'border-chat-orange/70 text-chat-text'
                  : 'border-white/[0.12] text-chat-muted hover:text-chat-text'
              }`}
            >
              Personalizado
            </button>
          </div>
          {showCustomInput && (
            <div className="flex flex-wrap items-center gap-2">
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
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-[14px] bg-wa-error-bg px-4 py-3 text-[14px] text-wa-error-text">
            <IconAlert className="h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {data && data.scope === 'agent' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile icon={<IconCheck className="h-5 w-5" />} value={data.own.closedCount} label="Atendimentos fechados" />
            <StatTile
              icon={<IconClock className="h-5 w-5" />}
              value={data.own.avgResolutionMinutes}
              label="Tempo médio de atendimento (min)"
            />
            <StatTile
              icon={<IconReply className="h-5 w-5" />}
              value={data.own.avgFirstResponseMinutes}
              label="Tempo médio de primeira resposta (min)"
            />
          </div>
        )}

        {data && data.scope === 'admin' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title="Atendimentos por atendente" icon={<IconUsers className="h-4 w-4" />}>
              {data.byAgent.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byAgent} barCategoryGap="32%">
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                    <XAxis dataKey="agentName" tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255, 255, 255, 0.06)' }} />
                    <Bar isAnimationActive={false} dataKey="closedCount" name="Atendimentos" fill={TEAL} radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Atendimentos por setor" icon={<IconLayers className="h-4 w-4" />}>
              {data.bySector.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.bySector} barCategoryGap="32%">
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                    <XAxis dataKey="sectorName" tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255, 255, 255, 0.06)' }} />
                    <Bar isAnimationActive={false} dataKey="closedCount" name="Atendimentos" fill={INDIGO} radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <div className="lg:col-span-2">
              <ChartCard title="Tempo médio por atendente (min)" icon={<IconGauge className="h-4 w-4" />}>
                {data.byAgent.length === 0 ? (
                  <EmptyState />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.byAgent} barCategoryGap="28%" barGap={4}>
                      <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                      <XAxis dataKey="agentName" tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255, 255, 255, 0.06)' }} />
                      <Legend wrapperStyle={{ fontSize: 13, color: AXIS_COLOR, paddingTop: 8 }} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="avgResolutionMinutes"
                        name="Tempo médio de atendimento"
                        fill={TEAL}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      />
                      <Bar
                        isAnimationActive={false}
                        dataKey="avgFirstResponseMinutes"
                        name="Tempo médio de primeira resposta"
                        fill={AMBER_DARK}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            <ChartCard title="Motivos de Contato" icon={<IconTag className="h-4 w-4" />}>
              {data.byReason.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byReason} barCategoryGap="32%">
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                    <XAxis dataKey="reasonName" tick={AXIS_TICK} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255, 255, 255, 0.06)' }} />
                    <Bar isAnimationActive={false} dataKey="closedCount" name="Atendimentos" fill={AMBER_DARK} radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        )}
      </div>
      </div>
      </div>
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

export default MetricsPage;
