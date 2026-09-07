import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import CreateChannelForm from '../components/CreateChannelForm';
import QrCodeView from '../components/QrCodeView';
import AgentsAdminTab from '../components/AgentsAdminTab';
import QuickRepliesAdminTab from '../components/QuickRepliesAdminTab';
import SectorsAdminTab from '../components/SectorsAdminTab';
import TriageAdminTab from '../components/TriageAdminTab';
import TemplatesAdminTab from '../components/TemplatesAdminTab';
import { setChannelTriageEnabled, setChannelWabaId } from '../services/api';

const TABS = [
  { value: 'channels', label: 'Canais' },
  { value: 'agents', label: 'Atendentes' },
  { value: 'quickReplies', label: 'Respostas rápidas' },
  { value: 'sectors', label: 'Setores' },
  { value: 'triage', label: 'Triagem' },
  { value: 'templates', label: 'Templates' },
];

const STATUS_LABELS = {
  connected: 'Conectado',
  awaiting_qr: 'Aguardando QR code',
  disconnected: 'Desconectado',
};

function StatusDot({ status }) {
  const color = status === 'connected' ? 'bg-teal-signal' : status === 'awaiting_qr' ? 'bg-amber-signal' : 'bg-ink-950/25';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-950/60">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function ChannelCard({ channel, wabaIdDrafts, setWabaIdDrafts, onToggleTriage, onSaveWabaId, onRefresh }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/50 p-4 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink-950">{channel.name}</p>
          <p className="text-sm text-ink-950/55">
            {channel.type === 'meta_cloud' ? 'Meta Cloud (oficial)' : 'Baileys (não oficial)'} — {channel.phoneNumber}
          </p>
        </div>
        <StatusDot status={channel.status} />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink-950/70">
        <input
          type="checkbox"
          checked={!!channel.triageEnabled}
          onChange={(e) => onToggleTriage(channel.id, e.target.checked)}
          className="h-4 w-4 accent-teal-signal"
        />
        Usar triagem automática
      </label>
      {channel.type === 'meta_cloud' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`waba-id-${channel.id}`} className="mb-1.5 block text-sm font-medium text-ink-950/70">
              WABA ID
            </label>
            <input
              id={`waba-id-${channel.id}`}
              value={wabaIdDrafts[channel.id] ?? channel.wabaId ?? ''}
              onChange={(e) => setWabaIdDrafts((prev) => ({ ...prev, [channel.id]: e.target.value }))}
              className="rounded-xl border border-ink-950/15 bg-white/60 px-3.5 py-2 text-sm text-ink-950 outline-none transition focus:border-teal-signal/60 focus:bg-white/90 focus:ring-2 focus:ring-teal-signal/25"
            />
          </div>
          <button
            onClick={() => onSaveWabaId(channel.id)}
            className="rounded-lg bg-teal-signal px-3 py-2 text-sm font-medium text-white transition hover:brightness-110"
          >
            Salvar WABA ID
          </button>
        </div>
      )}
      <QrCodeView channel={channel} onRefresh={onRefresh} />
    </div>
  );
}

function AdminChannelsPage() {
  const { token } = useAuth();
  const { channels, refresh } = useChannels();
  const [activeTab, setActiveTab] = useState('channels');
  const [triageToggleError, setTriageToggleError] = useState(null);
  const [wabaIdDrafts, setWabaIdDrafts] = useState({});
  const [wabaIdError, setWabaIdError] = useState(null);

  async function handleToggleTriage(channelId, triageEnabled) {
    setTriageToggleError(null);
    try {
      await setChannelTriageEnabled(channelId, triageEnabled, token);
      refresh();
    } catch (err) {
      setTriageToggleError((err.body && err.body.error) || 'Falha ao atualizar a triagem deste canal');
    }
  }

  async function handleSaveWabaId(channelId) {
    setWabaIdError(null);
    try {
      await setChannelWabaId(channelId, wabaIdDrafts[channelId], token);
      refresh();
    } catch (err) {
      setWabaIdError((err.body && err.body.error) || 'Falha ao atualizar o WABA ID');
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-gradient-to-br from-sky-mist via-teal-mist to-sand-mist font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal-signal/20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 top-96 h-96 w-96 rounded-full bg-amber-signal/25 blur-[120px]"
      />

      <div className="relative mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-950">Administração</h1>
          <p className="mt-1 text-sm text-ink-950/55">Canais, equipe e automações do atendimento</p>
        </div>

        <div className="inline-flex flex-wrap gap-1 rounded-full border border-white/70 bg-white/40 p-1 backdrop-blur-xl">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                activeTab === tab.value ? 'bg-teal-signal text-white shadow-sm' : 'text-ink-950/60 hover:text-ink-950'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'channels' ? (
          <div className="space-y-6">
            {triageToggleError && (
              <div className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">
                {triageToggleError}
              </div>
            )}
            {wabaIdError && (
              <div className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{wabaIdError}</div>
            )}
            <div className="space-y-3">
              {channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  wabaIdDrafts={wabaIdDrafts}
                  setWabaIdDrafts={setWabaIdDrafts}
                  onToggleTriage={handleToggleTriage}
                  onSaveWabaId={handleSaveWabaId}
                  onRefresh={refresh}
                />
              ))}
            </div>
            <CreateChannelForm onCreated={refresh} />
          </div>
        ) : activeTab === 'agents' ? (
          <AgentsAdminTab />
        ) : activeTab === 'quickReplies' ? (
          <QuickRepliesAdminTab />
        ) : activeTab === 'sectors' ? (
          <SectorsAdminTab />
        ) : activeTab === 'triage' ? (
          <TriageAdminTab />
        ) : (
          <TemplatesAdminTab />
        )}
      </div>
    </div>
  );
}

export default AdminChannelsPage;
