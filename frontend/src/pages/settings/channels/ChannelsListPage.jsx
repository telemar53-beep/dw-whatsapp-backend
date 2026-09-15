import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Button, Toggle, AsyncState } from '../../../components/ui';
import CreateChannelModal from '../../../components/CreateChannelModal';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { hasLevel } from '../../../navigation/navItems';
import { channelTypeLabel } from '../../../utils/channelTypes';
import { computeStatus } from '../../../components/OpenAiConfigCard';
import { StatusDot } from './ChannelConnectionTab';
import { channelSummary } from './channelSummary';

function ChannelCard({ channel, triageOptionsCount, nightWindowSet, openAiReady }) {
  const { chips, warnings } = channelSummary(channel, { triageOptionsCount, nightWindowSet, openAiReady });
  return (
    <Link
      to={`/configuracoes/canais/${channel.id}/conexao`}
      className="block rounded-2xl border border-wa-border bg-wa-surface p-4 transition hover:border-wa-border-strong hover:bg-wa-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <p className="truncate font-display text-[16px] font-semibold text-wa-text">{channel.name}</p>
          <p className="mt-0.5 truncate text-[13.5px] text-wa-muted">
            {channelTypeLabel(channel.type)} — {channel.phoneNumber}
          </p>
        </div>
        <StatusDot status={channel.status} type={channel.type} />
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-wa-border bg-wa-surface-soft px-2.5 py-[3px] text-[12px] font-medium text-wa-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {warnings.map((warning) => (
            <p key={warning} className="text-[12.5px] leading-[17px] text-wa-warn-text">
              {warning}
            </p>
          ))}
        </div>
      )}
    </Link>
  );
}

function ChannelsListPage() {
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const [searchParams, setSearchParams] = useSearchParams();
  const showHidden = searchParams.get('ocultos') === '1';
  const { channels, status, refresh } = useChannels(true, showHidden);
  const { options } = useTriage();
  const { config: aiConfig } = useAiConfig();
  const [creatingChannel, setCreatingChannel] = useState(false);

  const triageOptionsCount = options.length;
  const nightWindowSet = Boolean(aiConfig.nightStartTime && aiConfig.nightEndTime);
  const openAiReady =
    computeStatus({ mode: aiConfig.mode, configured: aiConfig.configured, hasError: false }) === 'Conectada';

  function toggleShowHidden(checked) {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set('ocultos', '1');
    else next.delete('ocultos');
    setSearchParams(next);
  }

  return (
    <SettingsPage
      title="Canais"
      description="Os números de WhatsApp ligados ao atendimento."
      scope="global"
      action={canManage && <Button onClick={() => setCreatingChannel(true)}>Criar canal</Button>}
      wide
    >
      <Toggle
        id="mostrar-canais-ocultos"
        checked={showHidden}
        onChange={(e) => toggleShowHidden(e.target.checked)}
        label="Mostrar canais ocultos"
      />

      <AsyncState
        status={status}
        onRetry={refresh}
        isEmpty={channels.length === 0}
        emptyMessage="Nenhum canal cadastrado ainda."
      >
        <div className="space-y-3">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              triageOptionsCount={triageOptionsCount}
              nightWindowSet={nightWindowSet}
              openAiReady={openAiReady}
            />
          ))}
        </div>
      </AsyncState>

      {creatingChannel && (
        <CreateChannelModal
          onClose={() => setCreatingChannel(false)}
          onCreated={() => {
            refresh();
            setCreatingChannel(false);
          }}
        />
      )}
    </SettingsPage>
  );
}

export default ChannelsListPage;
