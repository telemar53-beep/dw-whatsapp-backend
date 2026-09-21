import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCampaign } from '../services/api';
import { useAgentChannels } from '../hooks/useAgentChannels';
import { descreverFalha } from '../utils/failureReasons';
import { processadosDaCampanha, situacaoDaCampanha, campanhaTerminou } from '../utils/campaignStatus';
import './campaigns.css';
import { PageHeader, AsyncState } from '../components/ui';

const STATUS_LABELS = { pending: 'Pendente', sent: 'Enviado', failed: 'Falhou', skipped: 'Pulado' };
const STATUS_TONES = {
  pending: 'border-wa-warn-text/20 bg-wa-warn-bg text-wa-warn-text',
  sent: 'border-chat-online/20 bg-chat-online/[0.12] text-chat-online',
  failed: 'border-wa-error-text/20 bg-wa-error-bg text-wa-error-text',
  skipped: 'border-white/[0.10] bg-white/[0.06] text-chat-muted',
};

const FILTROS = [
  { value: 'todos', label: 'Todos' },
  { value: 'sent', label: 'Enviados' },
  { value: 'failed', label: 'Falharam' },
  { value: 'skipped', label: 'Pulados' },
  { value: 'pending', label: 'Pendentes' },
];

// A rota devolve TODOS os destinatários de uma vez, e a campanha aceita até
// 2000. Desenhar 2000 linhas — e redesenhá-las a cada consulta de 5s enquanto
// dispara — é peso puro. Paginar de verdade é dívida de backend; aqui o que dá
// para fazer é desenhar por lote.
const LOTE = 200;

function CampaignDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const { channels } = useAgentChannels();
  const [campaign, setCampaign] = useState(null);
  const [status, setStatus] = useState('loading');
  const [filtro, setFiltro] = useState('todos');
  const [limite, setLimite] = useState(LOTE);

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
      .catch((erro) => {
        // Uma falha pontual do polling não pode apagar o que já está na tela.
        // 404 não é "falhou": a campanha não existe, e chamar isso de erro de
        // carregamento fazia a migalha exibir "Sem nome" como se fosse o nome
        // real de uma campanha que nunca existiu.
        if (silencioso) return;
        setStatus(erro && erro.status === 404 ? 'inexistente' : 'error');
      });
  }, [id, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Os números do topo e o progresso respondem pela campanha inteira, sempre:
  // o filtro muda quem aparece na lista, não o que a campanha é.
  const processedCount = campaign ? processadosDaCampanha(campaign) : 0;
  const stillProcessing = campaign ? !campanhaTerminou(campaign) : false;

  useEffect(() => {
    if (!stillProcessing) return undefined;
    const interval = setInterval(() => {
      if (document.hidden) return;
      refresh({ silencioso: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [stillProcessing, refresh]);

  const destinatarios = campaign ? campaign.recipients : [];
  const porResultado = useMemo(() => {
    const contagem = { todos: destinatarios.length, sent: 0, failed: 0, skipped: 0, pending: 0 };
    for (const r of destinatarios) if (contagem[r.status] !== undefined) contagem[r.status] += 1;
    return contagem;
  }, [destinatarios]);

  const filtrados = useMemo(
    () => (filtro === 'todos' ? destinatarios : destinatarios.filter((r) => r.status === filtro)),
    [destinatarios, filtro]
  );

  function trocarFiltro(valor) {
    setFiltro(valor);
    setLimite(LOTE);
  }

  // `channelName` nunca vem no payload (a rota devolve só as colunas de
  // `campaigns`); quem resolve o nome é sempre a lista de canais.
  const channelName = campaign && channels.find((channel) => channel.id === campaign.channelId)?.name;

  // "Sem nome" é o rótulo de uma campanha real que ficou sem nome. Para uma
  // campanha que NÃO EXISTE ele mentia duas vezes: dizia que havia um recurso e
  // dizia que ele estava sem nome. O 404 é um estado próprio.
  const naoExiste = status === 'inexistente';
  const titulo = campaign ? campaign.name || 'Sem nome' : naoExiste ? 'Campanha não encontrada' : 'Campanha';

  return (
    <main className="campaigns-workspace flex min-h-0 flex-1 flex-col">
      <PageHeader
        variant="destaque"
        title={titulo}
        description={campaign ? 'Acompanhe o andamento e o resultado de cada destinatário.' : undefined}
        crumbs={[{ label: 'Campanhas', to: '/campanhas' }, { label: titulo }]}
      />

      <div className="campaigns-body chat-scroll">
        {naoExiste ? (
          <p role="alert" className="campaign-empty">Esta campanha não existe ou foi removida.</p>
        ) : (
        <AsyncState status={status} onRetry={refresh}>
          {campaign && <>
            <section className="campaign-summary" aria-label="Resumo da campanha">
              <div className="campaign-channel"><strong>{channelName || 'Canal não informado'}</strong><span>Canal de envio</span></div>
              {[["Destinatários", campaign.totalRecipients], ["Enviados", campaign.sentCount], ["Falharam", campaign.failedCount], ["Pulados", campaign.skippedCount]].map(([label, value]) => <div key={label}><strong>{(value || 0).toLocaleString('pt-BR')}</strong><span>{label}</span></div>)}
            </section>
            <div className="campaign-detail-progress"><span>{processedCount} de {campaign.totalRecipients} processados</span>
              <div className={`campaign-track${campanhaTerminou(campaign) ? ' is-completo' : ''}`} role="progressbar" aria-label="Destinatários processados" aria-valuemin={0} aria-valuemax={campaign.totalRecipients} aria-valuenow={processedCount}><span style={{ width: `${campaign.totalRecipients ? Math.min(100, processedCount / campaign.totalRecipients * 100) : 0}%` }} /></div>
              <small className={`campaign-situacao${campanhaTerminou(campaign) ? ' is-completo' : ''}`}>{situacaoDaCampanha(campaign)}</small>
            </div>
            <div className="campaign-section-heading"><h2>Destinatários</h2><span>{filtro === 'todos' ? `${campaign.recipients.length} registros` : `${filtrados.length} de ${campaign.recipients.length} registros`}</span></div>
            {campaign.recipients.length === 0 ? <p className="campaign-empty">Nenhum destinatário nesta campanha.</p> : <>
              <div className="campaign-filtro" role="group" aria-label="Filtrar destinatários por resultado">
                {FILTROS.map((f) => <button key={f.value} type="button" aria-pressed={filtro === f.value} onClick={() => trocarFiltro(f.value)}>{f.label}<strong>{porResultado[f.value]}</strong></button>)}
              </div>
              {filtrados.length === 0 ? <p className="campaign-sem-resultado">Nenhum destinatário com esse resultado.</p> : <>
              <div className="campaign-recipient-columns" aria-hidden="true"><span>Destinatário / telefone</span><span>Resultado</span><span>Detalhe do envio</span></div>
              <ul className="campaign-list">{filtrados.slice(0, limite).map((recipient) => <li key={recipient.id} className="campaign-recipient-row">
                <div className="campaign-identity"><strong>{recipient.displayName || recipient.phoneNumber}</strong>{recipient.displayName && <span>{recipient.phoneNumber}</span>}</div>
                <span className={`campaign-recipient-status ${STATUS_TONES[recipient.status] || STATUS_TONES.skipped}`}>{STATUS_LABELS[recipient.status] || recipient.status}</span>
                {/* Mesma tradução do envio avulso: códigos conhecidos viram frase,
                    e qualquer motivo sem mapeamento confiável passa inteiro. */}
                <p className={recipient.errorMessage ? 'campaign-error' : 'campaign-no-error'}>{descreverFalha(recipient.errorMessage) || '—'}</p>
              </li>)}</ul>
              {filtrados.length > limite && (
                <button type="button" className="campaign-mostrar-mais" onClick={() => setLimite((n) => n + LOTE)}>
                  Mostrar mais ({filtrados.length - limite} restantes)
                </button>
              )}
              </>}
            </>}
          </>}
        </AsyncState>
        )}
      </div>
    </main>
  );
}

export default CampaignDetailPage;
