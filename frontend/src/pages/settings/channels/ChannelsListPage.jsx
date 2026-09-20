import { SettingsTitle, SettingsIcon } from '../SettingsVisuals';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { Button, AsyncState, PageHeader } from '../../../components/ui';
import CreateChannelModal from '../../../components/CreateChannelModal';
import { IconNewChat } from '../../../components/icons/WaIcons';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { hasLevel } from '../../../navigation/navItems';
import { computeStatus } from '../../../components/OpenAiConfigCard';
import { useChannelActions } from './useChannelActions';
import { ChannelsTable } from './ChannelsTable';

export function useChannelSummaryContext() {
  const { options } = useTriage();
  const { config: aiConfig } = useAiConfig();
  return {
    triageOptionsCount: options.length,
    nightWindowSet: Boolean(aiConfig.nightStartTime && aiConfig.nightEndTime),
    openAiReady: computeStatus({ mode: aiConfig.mode, configured: aiConfig.configured, hasError: false }) === 'Conectada',
  };
}

function ChannelsListPage() {
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const [searchParams, setSearchParams] = useSearchParams();
  const showHidden = searchParams.get('ocultos') === '1';
  const { channels, status, refresh } = useChannels(true, showHidden);
  const summaryContext = useChannelSummaryContext();
  const actions = useChannelActions(refresh);
  const [creatingChannel, setCreatingChannel] = useState(false);

  function toggleShowHidden(checked) {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set('ocultos', '1');
    else next.delete('ocultos');
    setSearchParams(next);
  }

  return (
    <ProtectedRoute level="admin" areaLabel="Números conectados">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="settings-group-header border-b border-white/[0.07] px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: '/configuracoes' }, { label: 'WhatsApp e canais' }]}
            title={<SettingsTitle name="canais">Números conectados</SettingsTitle>}
            description="Gerencie os números e o atendimento de cada canal."
            action={
              canManage && (
                <Button onClick={() => setCreatingChannel(true)}>
                  <IconNewChat size={18} />
                  Adicionar canal
                </Button>
              )
            }
          />
        </div>
        <div className="settings-group-body chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-4 sm:px-6">
          <div className="max-w-6xl space-y-3">
            {actions.errors.action && (
              <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">{actions.errors.action}</p>
            )}
            <AsyncState status={status} onRetry={refresh}>
              <ChannelsTable
                channels={channels}
                summaryContext={summaryContext}
                actions={actions}
                canManage={canManage}
                extraControls={
                  <label className="flex h-10 cursor-pointer items-center gap-2 rounded-[12px] border border-wa-border bg-wa-field px-3.5 text-[13.5px] text-wa-text">
                    <input
                      id="mostrar-canais-ocultos"
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => toggleShowHidden(e.target.checked)}
                      className="h-4 w-4 accent-wa-green"
                    />
                    Mostrar ocultos
                  </label>
                }
              />
            </AsyncState>
          </div>
        </div>

        {actions.confirmDialog}
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
    </ProtectedRoute>
  );
}

export default ChannelsListPage;
