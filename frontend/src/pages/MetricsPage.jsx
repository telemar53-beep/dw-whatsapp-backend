import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';
import NavRail from '../components/NavRail';
import ChangePasswordModal from '../components/ChangePasswordModal';

const PERIODS = [
  { value: 'today', label: 'Últimas 24 horas' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

const TEAL = '#0d9488';
const AMBER_DARK = '#d9861f';
const INDIGO = '#3d6fb4';
const GRID_COLOR = 'rgba(11, 18, 32, 0.08)';
const AXIS_COLOR = 'rgba(11, 18, 32, 0.45)';
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(255, 255, 255, 0.94)',
  border: '1px solid rgba(11, 18, 32, 0.08)',
  borderRadius: 12,
  boxShadow: '0 20px 40px -20px rgba(15, 35, 60, 0.35)',
  fontSize: 13,
  color: '#0b1220',
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

function StatTile({ icon, value, label }) {
  const display = value === null || value === undefined ? '-' : value;
  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-teal-signal/30 bg-teal-signal/10 text-teal-signal">
        {icon}
      </span>
      <p className="font-display text-3xl font-semibold text-ink-950">{display}</p>
      <p className="mt-1 text-sm text-ink-950/55">{label}</p>
    </div>
  );
}

function ChartCard({ title, icon, children }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-teal-signal/30 bg-teal-signal/10 text-teal-signal">
          {icon}
        </span>
        <h2 className="font-display text-base font-semibold text-ink-950">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-950/15 bg-white/30 text-center">
      <IconInbox className="h-6 w-6 text-ink-950/30" />
      <p className="text-sm text-ink-950/50">Nenhum atendimento fechado nesse período.</p>
    </div>
  );
}

function MetricsPage() {
  const { token, agent } = useAuth();
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    setError(null);
    getMetrics(period, token)
      .then(setData)
      .catch(() => setError('Falha ao carregar métricas'));
  }, [period, token]);

  return (
    <div className="flex h-dvh">
      <NavRail active="metrics" onChangePasswordClick={() => setChangingPassword(true)} />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-gradient-to-br from-sky-mist via-teal-mist to-sand-mist font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-signal/20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 top-96 h-96 w-96 rounded-full bg-amber-signal/25 blur-[120px]"
      />

      <div className="relative mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink-950">Métricas</h1>
            <p className="mt-1 text-sm text-ink-950/55">Indicadores de atendimento da equipe</p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/40 px-3 py-1.5 text-sm font-medium text-ink-950/70 backdrop-blur-xl transition hover:bg-white/70 hover:text-ink-950"
          >
            <IconChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        </div>

        <div className="inline-flex flex-wrap gap-1 rounded-full border border-white/70 bg-white/40 p-1 backdrop-blur-xl">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                period === p.value ? 'bg-teal-signal text-white shadow-sm' : 'text-ink-950/60 hover:text-ink-950'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-700">
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
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(13, 148, 136, 0.08)' }} />
                    <Bar dataKey="closedCount" name="Atendimentos" fill={TEAL} radius={[6, 6, 0, 0]} maxBarSize={48} />
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
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(61, 111, 180, 0.08)' }} />
                    <Bar dataKey="closedCount" name="Atendimentos" fill={INDIGO} radius={[6, 6, 0, 0]} maxBarSize={48} />
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
                      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(11, 18, 32, 0.04)' }} />
                      <Legend wrapperStyle={{ fontSize: 13, color: AXIS_COLOR }} />
                      <Bar
                        dataKey="avgResolutionMinutes"
                        name="Tempo médio de atendimento"
                        fill={TEAL}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      />
                      <Bar
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
          </div>
        )}
      </div>
      </div>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

export default MetricsPage;
