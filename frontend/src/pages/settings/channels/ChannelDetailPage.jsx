import { SettingsTitle, SettingsIcon } from '../SettingsVisuals';
import { useEffect } from 'react';
import { useParams, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { AsyncState, PageHeader, ScopeBadge, Tabs } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { hasLevel } from '../../../navigation/navItems';
import { formatPhone } from '../../../utils/phone';
import { useChannelActions } from './useChannelActions';
import { ChannelIcon, ConnectionStatus, providerLabel } from './ChannelsTable';

function ChannelDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const { channels, status, refresh } = useChannels(true, true);
  const actions = useChannelActions(refresh);
  const channel = channels.find((c) => c.id === id);
  const currentTab = location.pathname.endsWith('/atendimento') ? 'atendimento' : 'conexao';

  // Enquanto o canal está mostrando um QR code, atualiza sozinho a cada 5s
  // para que a aba passe a "Conectado" assim que o celular termina de ler.
  useEffect(() => {
    if (!channel || channel.status !== 'awaiting_qr') return undefined;
    const interval = setInterval(() => refresh(), 5000);
    return () => clearInterval(interval);
  }, [channel?.status, refresh]);

  return (
    <ProtectedRoute level="admin" areaLabel="Canais WhatsApp">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="settings-group-header border-b border-white/[0.07] px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: '/configuracoes' }]}
            title={<SettingsTitle name="canais">Canais WhatsApp</SettingsTitle>}
            description="Gerencie os números e o atendimento de cada canal."
          />
        </div>
        <div className="settings-group-body chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-4 sm:px-6">
          <div className="max-w-6xl space-y-3">
            <AsyncState status={status} onRetry={refresh}>
              <div className="settings-channel-switch flex flex-wrap items-center justify-between gap-3">
                <Link to="/configuracoes/canais" className="text-[13px] font-medium text-wa-link hover:underline">← Todos os canais</Link>
                <label className="flex min-w-[220px] flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-wa-muted">
                  <span>Trocar de canal ({channels.length})</span>
                  <select
                    aria-label="Trocar de canal"
                    value={id}
                    onChange={(event) => navigate(`/configuracoes/canais/${event.target.value}/${currentTab}`)}
                    className="h-9 min-w-0 rounded-[10px] border border-wa-border bg-wa-field px-3 text-[13px] font-medium normal-case tracking-normal text-wa-text outline-none focus:border-wa-green/60 focus:ring-2 focus:ring-wa-green/25"
                  >
                    {channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatPhone(item.phoneNumber)}</option>)}
                  </select>
                </label>
              </div>

              {!channel ? (
                <div className="rounded-[16px] border border-wa-surface-line bg-wa-surface px-6 py-10 text-center text-[14px] text-wa-muted">
                  Canal não encontrado.{' '}
                  <Link to="/configuracoes/canais" className="text-wa-link underline">
                    Voltar para a lista
                  </Link>
                </div>
              ) : (
                <section
                  aria-labelledby="channel-detail-title"
                  className="overflow-clip rounded-[18px] border border-wa-surface-line bg-wa-surface"
                >
                  <div className="flex flex-wrap items-center gap-3 border-b border-wa-border px-4 py-4 sm:px-5">
                    <ChannelIcon size={40} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 id="channel-detail-title" className="truncate font-display text-[17px] font-semibold leading-[22px] text-wa-text">
                          {channel.name}
                        </h2>
                        <ScopeBadge scope="channel" />
                      </div>
                      <p className="mt-0.5 text-[13px] text-wa-muted">{formatPhone(channel.phoneNumber)} · {providerLabel(channel.type)}</p>
                    </div>
                    <div className="ml-auto"><ConnectionStatus channel={channel} /></div>
                  </div>
                  <div className="px-2 sm:px-3">
                    <Tabs
                      look="underline"
                      label="Seções do canal"
                      tabs={[
                        { key: 'conexao', label: 'Conexão', to: `/configuracoes/canais/${id}/conexao` },
                        { key: 'atendimento', label: 'Atendimento', to: `/configuracoes/canais/${id}/atendimento` },
                      ]}
                    />
                  </div>
                  <div className="px-4 pb-5 pt-5 sm:px-5">
                    <Outlet context={{ channel, refresh, actions, canManage }} />
                  </div>
                </section>
              )}
            </AsyncState>
          </div>
        </div>
        {actions.confirmDialog}
      </div>
    </ProtectedRoute>
  );
}

export default ChannelDetailPage;
