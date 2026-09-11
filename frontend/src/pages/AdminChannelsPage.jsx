import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import NavRail from '../components/NavRail';
import ProfileModal from '../components/ProfileModal';
import CreateChannelModal from '../components/CreateChannelModal';
import QrCodeView from '../components/QrCodeView';
import AgentsAdminTab from '../components/AgentsAdminTab';
import MessagesAdminTab from '../components/MessagesAdminTab';
import SectorsAdminTab from '../components/SectorsAdminTab';
import ReasonsAdminTab from '../components/ReasonsAdminTab';
import CitiesAdminTab from '../components/CitiesAdminTab';
import TriageAdminTab from '../components/TriageAdminTab';
import IntegrationsAdminTab from '../components/IntegrationsAdminTab';
import { setChannelTriageEnabled, setChannelWabaId, reconnectChannel, setChannelHidden, deleteChannel } from '../services/api';
import { isOfficialChannelType, channelTypeLabel } from '../utils/channelTypes';

// As seções ficam agrupadas pelo que a pessoa quer mudar, em vez de uma fileira
// de oito abas soltas: por onde o cliente fala, quem atende, o que é enviado.
const SECTION_GROUPS = [
  {
    group: 'Canais',
    items: [
      { value: 'channels', label: 'Canais', description: 'Os números de WhatsApp ligados ao atendimento.' },
      { value: 'triage', label: 'Triagem', description: 'O menu que o cliente recebe antes de falar com um atendente.' },
    ],
  },
  {
    group: 'Equipe',
    items: [
      { value: 'agents', label: 'Atendentes', description: 'Quem entra no painel e responde os clientes.' },
      { value: 'sectors', label: 'Setores', description: 'Os times para onde um atendimento pode ser transferido.' },
    ],
  },
  {
    group: 'Atendimento',
    items: [
      {
        value: 'quickReplies',
        label: 'Mensagens',
        description: 'Os textos que o sistema envia sozinho e as respostas rápidas da equipe.',
      },
      { value: 'reasons', label: 'Motivos', description: 'O motivo que o atendente escolhe ao encerrar um atendimento.' },
      { value: 'cities', label: 'Cidades', description: 'As cidades usadas no cadastro do cliente e nos avisos por região.' },
    ],
  },
  {
    group: 'Integrações',
    items: [
      {
        value: 'integrations',
        label: 'Integrações',
        description: 'A conexão com o SGP para consultar cliente, contrato e fatura.',
      },
    ],
  },
];

const SECTIONS = SECTION_GROUPS.flatMap((group) => group.items);

const STATUS_LABELS = {
  connected: 'Conectado',
  awaiting_qr: 'Aguardando QR code',
  disconnected: 'Desconectado',
};

function StatusDot({ status }) {
  const color =
    status === 'connected' ? 'bg-wa-chip-text' : status === 'awaiting_qr' ? 'bg-wa-warn-text' : 'bg-wa-border-strong';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-wa-border bg-wa-surface-soft px-2.5 py-[3px] text-[12.5px] font-medium text-wa-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} aria-hidden="true" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const cardButtonClass =
  'rounded-[10px] border border-wa-border bg-wa-surface px-3 py-1.5 text-[13.5px] font-medium text-wa-text transition hover:bg-wa-hover disabled:cursor-not-allowed disabled:opacity-50';

const primaryButtonClass =
  'shrink-0 rounded-[12px] bg-wa-green px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green';

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
    <div className="rounded-[18px] border border-wa-border bg-wa-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-medium text-wa-text">{channel.name}</p>
          <p className="mt-0.5 truncate text-[13.5px] text-wa-muted">
            {channelTypeLabel(channel.type)} — {channel.phoneNumber}
          </p>
        </div>
        <StatusDot status={channel.status} />
      </div>

      <label className="mt-4 flex items-center gap-2 text-[14px] text-wa-muted">
        <input
          type="checkbox"
          checked={!!channel.triageEnabled}
          onChange={(e) => onToggleTriage(channel.id, e.target.checked)}
          className="h-4 w-4 accent-wa-green"
        />
        Usar triagem automática
      </label>

      {isOfficialChannelType(channel.type) && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`waba-id-${channel.id}`} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
              WABA ID
            </label>
            <input
              id={`waba-id-${channel.id}`}
              value={wabaIdDrafts[channel.id] ?? channel.wabaId ?? ''}
              onChange={(e) => setWabaIdDrafts((prev) => ({ ...prev, [channel.id]: e.target.value }))}
              className="h-[42px] rounded-[12px] border border-wa-border bg-wa-field px-3.5 text-[14px] text-wa-text outline-none transition focus:border-wa-green/60"
            />
          </div>
          <button onClick={() => onSaveWabaId(channel.id)} className={primaryButtonClass}>
            Salvar WABA ID
          </button>
        </div>
      )}

      <QrCodeView channel={channel} onRefresh={onRefresh} />

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-wa-border pt-4">
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
          className="rounded-[10px] border border-wa-error-text/30 bg-wa-error-bg px-3 py-1.5 text-[13.5px] font-medium text-wa-error-text transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
    </div>
  );
}

function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">{children}</p>;
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);

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

  const section = SECTIONS.find((item) => item.value === activeTab) || SECTIONS[0];

  function sectionButtonClass(value) {
    return `relative flex w-auto shrink-0 items-center whitespace-nowrap rounded-[14px] px-3 py-2.5 text-left text-[14.5px] transition md:w-full ${
      activeTab === value
        ? 'bg-white/[0.10] font-medium text-chat-text'
        : 'text-chat-muted hover:bg-white/[0.05] hover:text-chat-text'
    }`;
  }

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[34%] -top-[12%] h-[38rem] w-[42rem] rounded-full bg-chat-copper/40 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[8%] bottom-[-18%] h-[30rem] w-[32rem] rounded-full bg-chat-copper/25 blur-[150px]"
      />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-3">
        <NavRail active="admin" onProfileClick={() => setProfileOpen(true)} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">

        <aside className="flex min-w-0 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.09] backdrop-blur-2xl md:w-[250px] md:shrink-0">
          <div className="shrink-0 px-5 pb-2 pt-4 md:pb-3 md:pt-6">
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
              Administração
            </h1>
            <p className="mt-1.5 text-[13.5px] leading-[19px] text-chat-muted">Como o atendimento funciona</p>
          </div>
          <nav className="chat-scroll flex min-h-0 gap-1 overflow-x-auto px-2 pb-3 md:flex-1 md:flex-col md:gap-0 md:overflow-x-hidden md:overflow-y-auto md:pb-5">
            {SECTION_GROUPS.map((group) => (
              <div key={group.group} className="flex gap-1 md:block">
                <p className="hidden px-3 pb-1.5 pt-4 text-[12px] font-medium text-chat-faint md:block">{group.group}</p>
                {group.items.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setActiveTab(item.value)}
                    className={sectionButtonClass(item.value)}
                  >
                    {activeTab === item.value && (
                      <span aria-hidden="true" className="absolute left-0 h-5 w-[3px] rounded-full bg-chat-orange" />
                    )}
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.08] backdrop-blur-2xl">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
            <div className="min-w-0">
              <h2 className="font-display text-[20px] font-semibold leading-tight text-chat-text">{section.label}</h2>
              <p className="mt-1 text-[14px] leading-[20px] text-chat-muted">{section.description}</p>
            </div>
            {activeTab === 'channels' && (
              <button type="button" onClick={() => setCreatingChannel(true)} className={primaryButtonClass}>
                Criar canal
              </button>
            )}
          </header>

          <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl">
              {activeTab === 'channels' ? (
                <div className="space-y-4">
                  <ErrorNote>{triageToggleError}</ErrorNote>
                  <ErrorNote>{wabaIdError}</ErrorNote>
                  <ErrorNote>{channelActionError}</ErrorNote>

                  <label className="flex items-center gap-2 text-[14px] text-wa-muted">
                    <input
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => setShowHidden(e.target.checked)}
                      className="h-4 w-4 accent-wa-green"
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

                  {creatingChannel && (
                    <CreateChannelModal
                      onClose={() => setCreatingChannel(false)}
                      onCreated={() => {
                        refresh();
                        setCreatingChannel(false);
                      }}
                    />
                  )}
                </div>
              ) : activeTab === 'agents' ? (
                <AgentsAdminTab />
              ) : activeTab === 'quickReplies' ? (
                <MessagesAdminTab />
              ) : activeTab === 'sectors' ? (
                <SectorsAdminTab />
              ) : activeTab === 'reasons' ? (
                <ReasonsAdminTab />
              ) : activeTab === 'cities' ? (
                <CitiesAdminTab />
              ) : activeTab === 'triage' ? (
                <TriageAdminTab />
              ) : (
                <IntegrationsAdminTab />
              )}
            </div>
          </div>
        </main>
        </div>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

export default AdminChannelsPage;
