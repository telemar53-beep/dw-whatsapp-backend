import { useEffect } from 'react';
import { useParams, Outlet, Link } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { AsyncState, PageHeader, ScopeBadge, Tabs } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { hasLevel } from '../../../navigation/navItems';
import { channelTypeLabel } from '../../../utils/channelTypes';
import { useChannelActions } from './useChannelActions';

function ChannelDetailPage() {
  const { id } = useParams();
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const { channels, status, refresh } = useChannels(true, true);
  const actions = useChannelActions(refresh);
  const channel = channels.find((c) => c.id === id);

  // Enquanto o canal está mostrando um QR code, atualiza sozinho a cada 5s
  // para que a aba passe a "Conectado" assim que o celular termina de ler —
  // igual ao polling que existia em AdminChannelsPage.
  useEffect(() => {
    if (!channel || channel.status !== 'awaiting_qr') return undefined;
    const interval = setInterval(() => refresh(), 5000);
    return () => clearInterval(interval);
  }, [channel?.status, refresh]);

  return (
    <ProtectedRoute level="admin" areaLabel="Canais">
      <div className="flex min-h-0 flex-1 flex-col">
        <AsyncState status={status} onRetry={refresh}>
          {!channel ? (
            <div className="px-6 py-10 text-center text-[14px] text-wa-muted">
              Canal não encontrado.{' '}
              <Link to="/configuracoes/canais" className="text-wa-link underline">
                Voltar para a lista
              </Link>
            </div>
          ) : (
            <>
              <div className="border-b border-white/[0.06] px-4">
                <PageHeader
                  crumbs={[
                    { label: 'Configurações', to: '/configuracoes' },
                    { label: 'Canais WhatsApp', to: '/configuracoes/canais' },
                  ]}
                  title={channel.name}
                  description={`${channelTypeLabel(channel.type)} · ${channel.phoneNumber}`}
                  action={<ScopeBadge scope="channel" />}
                />
                <div className="pb-4">
                  <Tabs
                    tabs={[
                      { key: 'conexao', label: 'Conexão', to: `/configuracoes/canais/${id}/conexao` },
                      { key: 'atendimento', label: 'Atendimento', to: `/configuracoes/canais/${id}/atendimento` },
                    ]}
                  />
                </div>
              </div>
              <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <div className="max-w-3xl space-y-6">
                  <Outlet context={{ channel, refresh, actions, canManage }} />
                </div>
              </div>
              {actions.confirmDialog}
            </>
          )}
        </AsyncState>
      </div>
    </ProtectedRoute>
  );
}

export default ChannelDetailPage;
