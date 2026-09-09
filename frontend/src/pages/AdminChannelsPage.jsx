import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import NavRail from '../components/NavRail';
import ChangePasswordModal from '../components/ChangePasswordModal';
import CreateChannelForm from '../components/CreateChannelForm';
import QrCodeView from '../components/QrCodeView';
import AgentsAdminTab from '../components/AgentsAdminTab';
import QuickRepliesAdminTab from '../components/QuickRepliesAdminTab';
import SectorsAdminTab from '../components/SectorsAdminTab';
import CitiesAdminTab from '../components/CitiesAdminTab';
import TriageAdminTab from '../components/TriageAdminTab';
import TemplatesAdminTab from '../components/TemplatesAdminTab';
import IntegrationsAdminTab from '../components/IntegrationsAdminTab';
import { setChannelTriageEnabled, setChannelWabaId, reconnectChannel, setChannelHidden, deleteChannel } from '../services/api';

const TABS = [
  { value: 'channels', label: 'Canais' },
  { value: 'agents', label: 'Atendentes' },
  { value: 'quickReplies', label: 'Respostas rápidas' },
  { value: 'sectors', label: 'Setores' },
  { value: 'cities', label: 'Cidades' },
  { value: 'triage', label: 'Triagem' },
  { value: 'templates', label: 'Templates' },
  { value: 'integrations', label: 'Integrações' },
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

const cardButtonClass =
  'rounded-lg border border-ink-950/15 bg-white/60 px-3 py-1.5 text-sm font-medium text-ink-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50';

function ChannelCard({
  channel,
  wabaIdDrafts,
  setWabaIdDrafts,
  onToggleTriage,
  onSaveWabaId,
  onRefresh,
  onReconnect,
  onToggleHidden,
  onDelete,
  busy,
}) {
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

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-950/10 pt-3">
        {channel.type === 'baileys' && (
          <button type="button" onClick={() => onReconnect(channel)} disabled={busy} className={cardButtonClass}>
            Reconectar
          </button>
        )}
        <button type="button" onClick={() => onToggleHidden(channel)} disabled={busy} className={cardButtonClass}>
          {channel.hidden ? 'Reexibir' : 'Ocultar'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(channel)}
          disabled={busy}
          className="rounded-lg border border-red-300 bg-white/60 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
    </div>
  );
}

function AdminChannelsPage() {
  const { token } = useAuth();
  const [showHidden, setShowHidden] = useState(false);
  const { channels, refresh } = useChannels(true, showHidden);
  const [activeTab, setActiveTab] = useState('channels');
  const [triageToggleError, setTriageToggleError] = useState(null);
  const [wabaIdDrafts, setWabaIdDrafts] = useState({});
  const [wabaIdError, setWabaIdError] = useState(null);
  const [channelActionError, setChannelActionError] = useState(null);
  const [busyChannelId, setBusyChannelId] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);

  // While a channel is showing a QR code, poll so the card flips to "Conectado"
  // on its own the moment the phone finishes scanning it.
  const hasChannelAwaitingQr = channels.some((channel) => channel.status === 'awaiting_qr');
  useEffect(() => {
    if (!hasChannelAwaitingQr) return undefined;
    const interval = setInterval(() => refresh(), 5000);
    return () => clearInterval(interval);
  }, [hasChannelAwaitingQr, refresh]);

  async function runChannelAction(channel, action) {
    setChannelActionError(null);
    setBusyChannelId(channel.id);
    try {
      await action();
      refresh();
    } catch (err) {
      setChannelActionError((err.body && err.body.error) || 'Não foi possível concluir a ação neste canal');
    } finally {
      setBusyChannelId(null);
    }
  }

  function handleReconnect(channel) {
    if (
      channel.status === 'connected' &&
      !window.confirm(`O canal "${channel.name}" está conectado. Reconectar vai derrubar a sessão atual e pedir um QR code novo. Continuar?`)
    ) {
      return;
    }
    runChannelAction(channel, () => reconnectChannel(channel.id, token));
  }

  function handleToggleHidden(channel) {
    const nextHidden = !channel.hidden;
    const message = nextHidden
      ? `Ocultar o canal "${channel.name}"? Ele sai da lista e a sessão do WhatsApp é encerrada. O histórico é preservado.`
      : `Reexibir o canal "${channel.name}"?`;
    if (!window.confirm(message)) return;
    runChannelAction(channel, () => setChannelHidden(channel.id, nextHidden, token));
  }

  function handleDelete(channel) {
    if (!window.confirm(`Excluir o canal "${channel.name}" definitivamente? Só é possível se ele nunca teve conversas.`)) return;
    runChannelAction(channel, () => deleteChannel(channel.id, token));
  }

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
    <div className="flex h-dvh">
      <NavRail active="admin" onChangePasswordClick={() => setChangingPassword(true)} />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-gradient-to-br from-sky-mist via-teal-mist to-sand-mist font-sans">
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
            {channelActionError && (
              <div className="rounded-lg border border-red-300 bg-red-50/80 px-3 py-2 text-sm text-red-700">{channelActionError}</div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-950/70">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="h-4 w-4 accent-teal-signal"
              />
              Mostrar canais ocultos
            </label>
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
                  onReconnect={handleReconnect}
                  onToggleHidden={handleToggleHidden}
                  onDelete={handleDelete}
                  busy={busyChannelId === channel.id}
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
        ) : activeTab === 'cities' ? (
          <CitiesAdminTab />
        ) : activeTab === 'triage' ? (
          <TriageAdminTab />
        ) : activeTab === 'templates' ? (
          <TemplatesAdminTab />
        ) : (
          <IntegrationsAdminTab />
        )}
      </div>
      </div>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

export default AdminChannelsPage;
