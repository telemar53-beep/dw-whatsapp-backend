import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { getMetrics } from '../services/api';

const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

function MetricCard({ label, value }) {
  return (
    <div className="rounded border border-gray-200 p-4 text-center">
      <p className="text-2xl font-semibold text-gray-800">{value === null || value === undefined ? '-' : value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function MetricsPage() {
  const { token, agent } = useAuth();
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    getMetrics(period, token)
      .then(setData)
      .catch(() => setError('Falha ao carregar métricas'));
  }, [period, token]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">Métricas</h1>
        <Link to="/" className="text-sm text-gray-500 hover:underline">
          Voltar
        </Link>
      </div>
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`rounded px-3 py-1 text-sm ${
              period === p.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && data.scope === 'agent' && (
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Atendimentos fechados" value={data.own.closedCount} />
          <MetricCard label="Tempo médio de atendimento (min)" value={data.own.avgResolutionMinutes} />
          <MetricCard label="Tempo médio de primeira resposta (min)" value={data.own.avgFirstResponseMinutes} />
        </div>
      )}
      {data && data.scope === 'admin' && (
        <div className="space-y-8">
          <div>
            <h2 className="mb-2 font-medium text-gray-700">Atendimentos por atendente</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.byAgent}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="agentName" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="closedCount" name="Atendimentos" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h2 className="mb-2 font-medium text-gray-700">Tempo médio por atendente (min)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.byAgent}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="agentName" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avgResolutionMinutes" name="Tempo médio de atendimento" fill="#2563eb" />
                <Bar dataKey="avgFirstResponseMinutes" name="Tempo médio de primeira resposta" fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h2 className="mb-2 font-medium text-gray-700">Atendimentos por setor</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.bySector}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sectorName" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="closedCount" name="Atendimentos" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default MetricsPage;
