import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listCampaigns } from '../services/api';
import { useAgentChannels } from '../hooks/useAgentChannels';
import './campaigns.css';
import metaLogo from '../assets/brands/meta.svg';
import CreateCampaignModal from '../components/CreateCampaignModal';
import { PageHeader, Button, AsyncState } from '../components/ui';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CampaignsPage() {
  const { token } = useAuth();
  const { channels } = useAgentChannels();
  const [campaigns, setCampaigns] = useState([]);
  const [status, setStatus] = useState('loading');
  const [creating, setCreating] = useState(false);

  const channelNameById = channels.reduce((acc, channel) => {
    acc[channel.id] = channel.name;
    return acc;
  }, {});

  // `silencioso` pelo mesmo motivo do detalhe: com `status='loading'` o
  // AsyncState descarta a árvore e a lista inteira vira skeleton. Numa
  // atualização — automática ou pelo botão — os números precisam trocar
  // debaixo de uma lista que continua na tela.
  const refresh = useCallback(({ silencioso = false } = {}) => {
    if (!silencioso) setStatus('loading');
    return listCampaigns(token)
      .then((data) => {
        setCampaigns(data);
        setStatus('ready');
      })
      .catch(() => {
        // Uma falha pontual do polling não pode apagar o que já está na tela.
        if (!silencioso) setStatus('error');
      });
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Só enquanto houver campanha com destinatário por processar. Quando todas
  // terminam, o polling para: não há mais número que possa mudar sozinho.
  const algumaProcessando = campaigns.some(
    (c) => c.sentCount + c.failedCount + c.skippedCount < c.totalRecipients
  );

  useEffect(() => {
    if (!algumaProcessando) return undefined;
    const intervalo = setInterval(() => {
      if (document.hidden) return;
      refresh({ silencioso: true });
    }, 10000);
    return () => clearInterval(intervalo);
  }, [algumaProcessando, refresh]);

  return (
    <div className="campaigns-workspace flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Campanhas"
        description="Disparo em massa para uma lista de clientes"
        action={
          <>
            <Button variant="secondary" className="campaign-create-button" onClick={() => refresh({ silencioso: true })}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3v3.5H13" /></svg>
              <span>Atualizar</span>
            </Button>
            <Button className="campaign-create-button" onClick={() => setCreating(true)}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" /></svg>
              <span>Nova campanha</span>
            </Button>
          </>
        }
      />

      <div className="campaigns-body chat-scroll">
        <AsyncState status={status} onRetry={refresh}>
          {campaigns.length === 0 ? <section className="campaign-empty">
            <span className="campaign-eyebrow">COMECE PELO PRIMEIRO ENVIO</span>
            <h2>Nenhuma campanha criada ainda</h2>
            <p>Use “Nova campanha” para escolher o canal, preparar a mensagem e revisar os destinatários antes do disparo.</p>
          </section> : <>
            <section className="campaign-summary" aria-label="Resultados das campanhas listadas">
              <div><strong>{campaigns.length}</strong><span>Campanhas listadas</span></div>
              {[["Destinatários", "totalRecipients"], ["Enviados", "sentCount"], ["Falharam", "failedCount"], ["Pulados", "skippedCount"]].map(([label, key]) => <div key={key}><strong>{campaigns.reduce((sum, item) => sum + item[key], 0).toLocaleString('pt-BR')}</strong><span>{label}</span></div>)}
            </section>
            <div className="campaign-section-heading"><h2>Comparar campanhas</h2></div>
            <div className="campaign-columns" aria-hidden="true"><span>Campanha / canal</span><span>Destinatários</span><span>Enviados</span><span>Falharam</span><span>Pulados</span><span>Processados</span></div>
            <ul className="campaign-list">{campaigns.map((campaign) => {
              const channelType = channels.find((channel) => channel.id === campaign.channelId)?.type;
              const processed = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
              return <li key={campaign.id}><Link to={`/campanhas/${campaign.id}`} className="campaign-row">
                <span className="campaign-identity"><strong>{campaign.name || 'Sem nome'}</strong><span>{channelType === 'meta_cloud' && <span className="campaign-provider-mark" role="img" aria-label="Meta Cloud" style={{ maskImage: `url(${metaLogo})` }} />}{campaign.channelName || channelNameById[campaign.channelId] || '—'}<i>·</i>{formatDate(campaign.createdAt)}</span></span>
                <span className="campaign-number"><small>Destinatários</small>{campaign.totalRecipients}</span>
                <span className="campaign-number campaign-sent"><small>Enviados</small>{campaign.sentCount}</span>
                <span className={`campaign-number ${campaign.failedCount ? 'campaign-failed' : ''}`}><small>Falharam</small>{campaign.failedCount}</span>
                <span className="campaign-number campaign-skipped"><small>Pulados</small>{campaign.skippedCount}</span>
                <span className="campaign-progress"><span><small className="campaign-rotulo">Processados </small>{processed} / {campaign.totalRecipients}</span><span className="campaign-track" aria-hidden="true"><span style={{ width: `${campaign.totalRecipients ? Math.min(100, processed / campaign.totalRecipients * 100) : 0}%` }} /></span></span>
              </Link></li>;
            })}</ul>
          </>}
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
