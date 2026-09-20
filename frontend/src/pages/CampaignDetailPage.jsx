import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCampaign } from '../services/api';
import { useAgentChannels } from '../hooks/useAgentChannels';
import './campaigns.css';
import { PageHeader, AsyncState } from '../components/ui';

const STATUS_LABELS = { pending: 'Pendente', sent: 'Enviado', failed: 'Falhou', skipped: 'Pulado' };
const STATUS_TONES = {
  pending: 'border-wa-warn-text/20 bg-wa-warn-bg text-wa-warn-text',
  sent: 'border-chat-online/20 bg-chat-online/[0.12] text-chat-online',
  failed: 'border-wa-error-text/20 bg-wa-error-bg text-wa-error-text',
  skipped: 'border-white/[0.10] bg-white/[0.06] text-chat-muted',
};

function CampaignDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const { channels } = useAgentChannels();
  const [campaign, setCampaign] = useState(null);
  const [status, setStatus] = useState('loading');

  // `silencioso` existe porque o polling de 5s chamava este mesmo refresh:
  // com `status='loading'`, o AsyncState descartava a árvore e a tela inteira
  // (resumo, progresso, destinatários e a posição da rolagem) virava skeleton
  // a cada 5 segundos — justamente enquanto a campanha dispara e a pessoa está
  // olhando. Só a primeira carga mostra o skeleton.
  const refresh = useCallback(({ silencioso = false } = {}) => {
    if (!silencioso) setStatus('loading');
    return getCampaign(id, token)
      .then((data) => {
        setCampaign(data);
        setStatus('ready');
      })
      .catch(() => {
        // Uma falha pontual do polling não pode apagar o que já está na tela.
        if (!silencioso) setStatus('error');
      });
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
      refresh({ silencioso: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [stillProcessing, refresh]);

  const channelName = campaign && (campaign.channelName || channels.find((channel) => channel.id === campaign.channelId)?.name);

  return (
    <div className="campaigns-workspace flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={campaign ? campaign.name || 'Sem nome' : 'Campanha'}
        description={campaign ? 'Acompanhe o andamento e o resultado de cada destinatário.' : undefined}
        crumbs={[{ label: 'Campanhas', to: '/campanhas' }, { label: campaign?.name || 'Sem nome' }]}
      />

      <div className="campaigns-body chat-scroll">
        <AsyncState status={status} onRetry={refresh}>
          {campaign && <>
            <section className="campaign-summary" aria-label="Resumo da campanha">
              <div className="campaign-channel"><strong>{channelName || 'Canal não informado'}</strong><span>Canal de envio</span></div>
              {[["Destinatários", campaign.totalRecipients], ["Enviados", campaign.sentCount], ["Falharam", campaign.failedCount], ["Pulados", campaign.skippedCount]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
            </section>
            <div className="campaign-detail-progress"><span>{processedCount} de {campaign.totalRecipients} processados</span>
              <div className="campaign-track" role="progressbar" aria-label="Destinatários processados" aria-valuemin={0} aria-valuemax={campaign.totalRecipients} aria-valuenow={processedCount}><span style={{ width: `${campaign.totalRecipients ? Math.min(100, processedCount / campaign.totalRecipients * 100) : 0}%` }} /></div>
            </div>
            <div className="campaign-section-heading"><h2>Destinatários</h2><span>{campaign.recipients.length} registros</span></div>
            {campaign.recipients.length === 0 ? <p className="campaign-empty">Nenhum destinatário nesta campanha.</p> : <>
              <div className="campaign-recipient-columns" aria-hidden="true"><span>Destinatário / telefone</span><span>Resultado</span><span>Detalhe do envio</span></div>
              <ul className="campaign-list">{campaign.recipients.map((recipient) => <li key={recipient.id} className="campaign-recipient-row">
                <div className="campaign-identity"><strong>{recipient.displayName || recipient.phoneNumber}</strong>{recipient.displayName && <span>{recipient.phoneNumber}</span>}</div>
                <span className={`campaign-recipient-status ${STATUS_TONES[recipient.status] || STATUS_TONES.skipped}`}>{STATUS_LABELS[recipient.status] || recipient.status}</span>
                <p className={recipient.errorMessage ? 'campaign-error' : 'campaign-no-error'}>{recipient.errorMessage || '—'}</p>
              </li>)}</ul>
            </>}
          </>}
        </AsyncState>
      </div>
    </div>
  );
}

export default CampaignDetailPage;
