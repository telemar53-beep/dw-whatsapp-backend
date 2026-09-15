import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCampaign } from '../services/api';
import { useAgentChannels } from '../hooks/useAgentChannels';
import { PageHeader, AsyncState } from '../components/ui';

const STATUS_LABELS = { pending: 'Pendente', sent: 'Enviado', failed: 'Falhou', skipped: 'Pulado' };

function CampaignDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const { channels } = useAgentChannels();
  const [campaign, setCampaign] = useState(null);
  const [status, setStatus] = useState('loading');

  const refresh = useCallback(() => {
    setStatus('loading');
    return getCampaign(id, token)
      .then((data) => {
        setCampaign(data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [id, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const processedCount = campaign ? campaign.sentCount + campaign.failedCount + campaign.skippedCount : 0;
  const stillProcessing = campaign ? processedCount < campaign.totalRecipients : false;

  useEffect(() => {
    if (!stillProcessing) return undefined;
    const interval = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [stillProcessing, refresh]);

  const channelName = campaign && (campaign.channelName || channels.find((channel) => channel.id === campaign.channelId)?.name);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={campaign ? campaign.name || 'Sem nome' : 'Campanha'}
        description={
          campaign
            ? `Canal: ${channelName || '—'} — ${campaign.sentCount} enviados, ${campaign.failedCount} falharam, ${campaign.skippedCount} pulados de ${campaign.totalRecipients}`
            : undefined
        }
        crumbs={[{ label: 'Campanhas', to: '/campanhas' }, { label: campaign?.name || 'Sem nome' }]}
      />

      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <AsyncState status={status} onRetry={refresh} isEmpty={status === 'ready' && campaign && campaign.recipients.length === 0} emptyMessage="Nenhum destinatário nesta campanha.">
          {campaign && (
            <ul className="space-y-1.5">
              {campaign.recipients.map((recipient) => (
                <li
                  key={recipient.id}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-4 py-2.5"
                >
                  <div>
                    <p className="text-[14px] text-chat-text">{recipient.displayName || recipient.phoneNumber}</p>
                    {recipient.errorMessage && <p className="text-[12.5px] text-chat-muted">{recipient.errorMessage}</p>}
                  </div>
                  <span className="shrink-0 text-[12.5px] text-chat-muted">{STATUS_LABELS[recipient.status] || recipient.status}</span>
                </li>
              ))}
            </ul>
          )}
        </AsyncState>
      </div>
    </div>
  );
}

export default CampaignDetailPage;
