import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { Button, AsyncState, PageHeader } from '../../../components/ui';
import CreateChannelModal from '../../../components/CreateChannelModal';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { hasLevel } from '../../../navigation/navItems';
import { computeStatus } from '../../../components/OpenAiConfigCard';
import { useChannelActions } from './useChannelActions';
import { CartoesDeCanais } from './CartoesDeCanais';
import SettingsShell from '../SettingsShell';

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
    <SettingsShell
      areaLabel="Números conectados"
      title="Números conectados"
      iconName="canais"
      description="Gerencie os números e o atendimento de cada canal."
      width="table"
      action={
        canManage && (
          <Button onClick={() => setCreatingChannel(true)}>Adicionar canal</Button>
        )
      }
    >
            {actions.errors.action && (
              <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">{actions.errors.action}</p>
            )}
            <AsyncState status={status} onRetry={refresh}>
              <CartoesDeCanais
                channels={channels}
                summaryContext={summaryContext}
                actions={actions}
                canManage={canManage}
                extraControls={
                  <label className="cfg-canais-ocultos">
                    <input
                      id="mostrar-canais-ocultos"
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => toggleShowHidden(e.target.checked)}
                    />
                    Mostrar ocultos
                  </label>
                }
              />
      </AsyncState>

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
    </SettingsShell>
  );
}

export default ChannelsListPage;
