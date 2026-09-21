import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listCampaigns } from '../services/api';
import { useAgentChannels } from '../hooks/useAgentChannels';
import { processadosDaCampanha, situacaoDaCampanha, campanhaTerminou } from '../utils/campaignStatus';
import './campaigns.css';
import metaLogo from '../assets/brands/meta.svg';
import CreateCampaignModal from '../components/CreateCampaignModal';
import { PageHeader, Button, AsyncState } from '../components/ui';

function formatDate(iso) {
  const data = iso ? new Date(iso) : null;
  // Sem guarda, um createdAt ausente ou torto virava "Invalid Date" na linha.
  if (!data || Number.isNaN(data.getTime())) return 'Data não informada';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// O resumo do topo já usava separador de milhar e as linhas não: 1.240 em cima
// e 1240 embaixo, na mesma tela.
const numero = (valor) => (valor || 0).toLocaleString('pt-BR');

const ORDENS = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigas', label: 'Mais antigas' },
  { value: 'nome', label: 'Nome (A–Z)' },
  { value: 'destinatarios', label: 'Mais destinatários' },
  { value: 'falhas', label: 'Mais falhas' },
];

const porData = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

function ordenar(itens, ordem) {
  const copia = [...itens];
  if (ordem === 'antigas') return copia.sort((a, b) => porData(b, a));
  if (ordem === 'nome') return copia.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  if (ordem === 'destinatarios') return copia.sort((a, b) => b.totalRecipients - a.totalRecipients || porData(a, b));
  if (ordem === 'falhas') return copia.sort((a, b) => b.failedCount - a.failedCount || porData(a, b));
  return copia.sort(porData);
}

function CampaignsPage() {
  const { token } = useAuth();
  const { channels } = useAgentChannels();
  const [campaigns, setCampaigns] = useState([]);
  const [status, setStatus] = useState('loading');
  const [creating, setCreating] = useState(false);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('recentes');

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
  const algumaProcessando = campaigns.some((c) => !campanhaTerminou(c));

  useEffect(() => {
    if (!algumaProcessando) return undefined;
    const intervalo = setInterval(() => {
      if (document.hidden) return;
      refresh({ silencioso: true });
    }, 10000);
    return () => clearInterval(intervalo);
  }, [algumaProcessando, refresh]);

  // Busca e ordenação são client-side, sobre o que já veio: a rota de listagem
  // não aceita filtro nem página. Com muitas campanhas isso vira dívida de
  // backend, não um filtro que mente sobre o que existe.
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const casa = (campaign) => {
      if (!termo) return true;
      const canal = channelNameById[campaign.channelId] || '';
      return `${campaign.name || ''} ${canal}`.toLowerCase().includes(termo);
    };
    return ordenar(campaigns.filter(casa), ordem);
  }, [campaigns, busca, ordem, channels]);

  return (
    <div className="campaigns-workspace flex min-h-0 flex-1 flex-col">
      <PageHeader
        variant="destaque"
        title="Campanhas"
        description="Disparo em massa para uma lista de clientes"
        action={
          <>
            <Button variant="secondary" className="campaign-create-button" onClick={() => refresh({ silencioso: true })}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3v3.5H13" /></svg>
              <span>Atualizar</span>
            </Button>
            <Button className="campaign-create-button" onClick={() => setCreating(true)}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" /></svg>
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
            <div className="campaign-section-heading"><h2>Comparar campanhas</h2><span>{visiveis.length === campaigns.length ? `${campaigns.length} campanhas` : `${visiveis.length} de ${campaigns.length} campanhas`}</span></div>
            <div className="campaign-toolbar">
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou canal" aria-label="Buscar campanha por nome ou canal" />
              <label htmlFor="campaign-ordem">Ordenar por</label>
              <select id="campaign-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
                {ORDENS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {visiveis.length === 0 ? <p className="campaign-sem-resultado">Nenhuma campanha corresponde a “{busca.trim()}”.</p> : <>
            <div className="campaign-columns" aria-hidden="true"><span>Campanha / canal</span><span>Destinatários</span><span>Enviados</span><span>Falharam</span><span>Pulados</span><span>Processados</span></div>
            <ul className="campaign-list">{visiveis.map((campaign) => {
              const channelType = channels.find((channel) => channel.id === campaign.channelId)?.type;
              const processed = processadosDaCampanha(campaign);
              const situacao = situacaoDaCampanha(campaign);
              const terminou = campanhaTerminou(campaign);
              return <li key={campaign.id}><Link to={`/campanhas/${campaign.id}`} className="campaign-row">
                <span className="campaign-identity"><strong>{campaign.name || 'Sem nome'}</strong><span>{channelType === 'meta_cloud' && <span className="campaign-provider-mark" role="img" aria-label="Meta Cloud" style={{ maskImage: `url(${metaLogo})` }} />}{channelNameById[campaign.channelId] || '—'}<i>·</i>{formatDate(campaign.createdAt)}</span></span>
                <span className="campaign-number"><small>Destinatários</small>{numero(campaign.totalRecipients)}</span>
                <span className="campaign-number campaign-sent"><small>Enviados</small>{numero(campaign.sentCount)}</span>
                <span className={`campaign-number ${campaign.failedCount ? 'campaign-failed' : ''}`}><small>Falharam</small>{numero(campaign.failedCount)}</span>
                <span className="campaign-number campaign-skipped"><small>Pulados</small>{numero(campaign.skippedCount)}</span>
                <span className="campaign-progress"><span><small className="campaign-rotulo">Processados </small>{numero(processed)} / {numero(campaign.totalRecipients)}</span><span className={`campaign-track${terminou ? ' is-completo' : ''}`} aria-hidden="true"><span style={{ width: `${campaign.totalRecipients ? Math.min(100, processed / campaign.totalRecipients * 100) : 0}%` }} /></span><small className={`campaign-situacao${terminou ? ' is-completo' : ''}`}>{situacao}</small></span>
              </Link></li>;
            })}</ul>
            </>}
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
