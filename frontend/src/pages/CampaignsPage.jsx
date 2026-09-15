import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listCampaigns } from '../services/api';
import { useChannels } from '../hooks/useChannels';
import CreateCampaignModal from '../components/CreateCampaignModal';
import { PageHeader, Button, AsyncState } from '../components/ui';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CampaignsPage() {
  const { token } = useAuth();
  const { channels } = useChannels();
  const [campaigns, setCampaigns] = useState([]);
  const [status, setStatus] = useState('loading');
  const [creating, setCreating] = useState(false);

  const channelNameById = channels.reduce((acc, channel) => {
    acc[channel.id] = channel.name;
    return acc;
  }, {});

  const refresh = useCallback(() => {
    setStatus('loading');
    return listCampaigns(token)
      .then((data) => {
        setCampaigns(data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Campanhas"
        description="Disparo em massa para uma lista de clientes"
        action={<Button onClick={() => setCreating(true)}>Nova campanha</Button>}
      />

      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <AsyncState status={status} onRetry={refresh} isEmpty={status === 'ready' && campaigns.length === 0} emptyMessage="Nenhuma campanha criada ainda.">
          <ul className="space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  to={`/campanhas/${campaign.id}`}
                  className="block rounded-[16px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.07]"
                >
                  <p className="text-[15px] font-medium text-chat-text">{campaign.name || 'Sem nome'}</p>
                  <p className="mt-1 text-[13px] text-chat-muted">
                    Canal: {campaign.channelName || channelNameById[campaign.channelId] || '—'}
                  </p>
                  <p className="mt-1 text-[13px] text-chat-muted">
                    {formatDate(campaign.createdAt)} — {campaign.sentCount} enviados, {campaign.failedCount} falharam,{' '}
                    {campaign.skippedCount} pulados de {campaign.totalRecipients}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </AsyncState>
      </div>

      {creating && (
        <CreateCampaignModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export default CampaignsPage;
