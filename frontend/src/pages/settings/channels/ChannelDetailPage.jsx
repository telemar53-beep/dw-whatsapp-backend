import { useEffect } from 'react';
import { useParams, Outlet, Link } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { AsyncState, PageHeader, ScopeBadge, Tabs } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { hasLevel } from '../../../navigation/navItems';
import { formatPhone } from '../../../utils/phone';
import { useChannelActions } from './useChannelActions';
import { ChannelsTable, ChannelIcon } from './ChannelsTable';
import { useChannelSummaryContext } from './ChannelsListPage';

// A mesma tela da lista, com o canal escolhido marcado na tabela e o seu
// cartão de configuração logo abaixo — como no print de referência.
function ChannelDetailPage() {
  const { id } = useParams();
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const { channels, status, refresh } = useChannels(true, true);
  const summaryContext = useChannelSummaryContext();
  const actions = useChannelActions(refresh);
  const channel = channels.find((c) => c.id === id);

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
        <div className="px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: '/configuracoes' }]}
            title="Canais WhatsApp"
            description="Gerencie os números e o atendimento de cada canal."
          />
        </div>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2 sm:px-6">
          <div className="max-w-6xl space-y-5">
            <AsyncState status={status} onRetry={refresh}>
              <ChannelsTable channels={channels} selectedId={id} summaryContext={summaryContext} actions={actions} canManage={canManage} />

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
                  className="overflow-clip rounded-[16px] border border-wa-surface-line bg-wa-surface backdrop-blur-xl"
                >
                  <div className="flex items-center gap-3 px-4 pb-1 pt-5 sm:px-5">
                    <ChannelIcon size={40} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 id="channel-detail-title" className="truncate font-display text-[17px] font-semibold leading-[22px] text-wa-text">
                          {channel.name}
                        </h2>
                        <ScopeBadge scope="channel" />
                      </div>
                      <p className="mt-0.5 text-[13px] text-wa-muted">{formatPhone(channel.phoneNumber)}</p>
                    </div>
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
