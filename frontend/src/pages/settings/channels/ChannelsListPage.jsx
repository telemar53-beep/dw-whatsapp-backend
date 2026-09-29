import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, AsyncState } from '../../../components/ui';
import { IconeCanais } from '../../../components/icones';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { hasLevel } from '../../../navigation/navItems';
import { computeStatus } from '../../../components/OpenAiConfigCard';
import { sobDemanda, useSobDemanda } from '../../../utils/sobDemanda';
import { useChannelActions } from './useChannelActions';
import { CartoesDeCanais } from './CartoesDeCanais';
import { AvisoDeSucesso } from './AvisoDeSucesso';
import SettingsShell from '../SettingsShell';

// O Adicionar canal só chega quando é aberto (Fatia S2): o código do diálogo,
// a folha dele e os três formulários ficam fora do trecho da lista.
const ADICIONAR = sobDemanda(() => import('./AdicionarCanalDialog'));

export function useChannelSummaryContext() {
  const { options } = useTriage();
  const { config: aiConfig } = useAiConfig();
  return {
    triageOptionsCount: options.length,
    nightWindowSet: Boolean(aiConfig.nightStartTime && aiConfig.nightEndTime),
    openAiReady: computeStatus({ mode: aiConfig.mode, configured: aiConfig.configured, hasError: false }) === 'Conectada',
  };
}

const AVISOS = {
  excluir: (canal) => ({ titulo: 'Canal excluído', texto: `“${canal.name}” foi removido da lista.` }),
  ocultar: (canal) => ({ titulo: 'Canal ocultado', texto: `“${canal.name}” saiu da lista. Nada foi apagado.` }),
  reexibir: (canal) => ({ titulo: 'Canal reexibido', texto: `“${canal.name}” voltou para a lista.` }),
  reconectar: (canal) => ({ titulo: 'Novo QR code gerado', texto: `Abra “${canal.name}” para ler o código.` }),
};

function ListaVazia({ canManage, onAdicionar, acaoRef }) {
  return (
    <section className="cfg-canais-estado" aria-labelledby="cfg-canais-vazia">
      <span className="cfg-canais-estado-icone" aria-hidden="true"><IconeCanais tamanho={24} /></span>
      <h2 id="cfg-canais-vazia">Nenhum canal conectado</h2>
      {canManage ? (
        <>
          <p>Adicione o primeiro número para receber e enviar mensagens pelo atendimento.</p>
          <button type="button" ref={acaoRef} className="cfg-canais-estado-botao is-principal" onClick={onAdicionar}>Adicionar primeiro canal</button>
        </>
      ) : (
        <p>Peça a um administrador para adicionar o primeiro número.</p>
      )}
    </section>
  );
}

function FalhaAoCarregar({ onTentar }) {
  return (
    <section className="cfg-canais-estado is-erro" role="alert" aria-labelledby="cfg-canais-falha">
      <h2 id="cfg-canais-falha">Não foi possível carregar os canais</h2>
      <p>A lista não está disponível agora. Tente novamente sem sair desta página.</p>
      <button type="button" className="cfg-canais-estado-botao" onClick={onTentar}>Tentar novamente</button>
    </section>
  );
}

function ChannelsListPage() {
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showHidden = searchParams.get('ocultos') === '1';
  const { channels, status, refresh } = useChannels(true, showHidden);
  const summaryContext = useChannelSummaryContext();
  const [aviso, setAviso] = useState(() => (location.state && location.state.aviso) || null);
  const [adicionando, setAdicionando] = useState(false);
  const [falhaAoAbrir, setFalhaAoAbrir] = useState(false);
  const buscaRef = useRef(null);
  const vazioRef = useRef(null);
  const veioDoDetalhe = useRef(Boolean(location.state && location.state.aviso));
  const fecharAviso = useCallback(() => setAviso(null), []);

  // O aviso que veio do detalhe (exclusão concluída) é lido uma vez; a
  // entrada do histórico perde o estado, para não voltar num "voltar".
  useEffect(() => {
    if (location.state && location.state.aviso) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chegando do detalhe de um canal que acabou de ser excluído, o foco estaria
  // solto no <body>: vai para a busca, ou para a ação da lista vazia.
  useEffect(() => {
    if (!veioDoDetalhe.current || status !== 'ready') return undefined;
    const quadro = requestAnimationFrame(() => {
      veioDoDetalhe.current = false;
      if (document.activeElement && document.activeElement !== document.body) return;
      const alvo = buscaRef.current || vazioRef.current;
      if (alvo) alvo.focus();
    });
    return () => cancelAnimationFrame(quadro);
  }, [status]);

  const actions = useChannelActions(refresh, {
    aoConcluir: (tipo, canal) => {
      setAviso(AVISOS[tipo](canal));
      // O cartão de onde saiu a ação pode ter sumido (excluído, ocultado): o
      // foco não fica solto no <body>, vai para a busca da lista.
      requestAnimationFrame(() => {
        if ((!document.activeElement || document.activeElement === document.body) && buscaRef.current) buscaRef.current.focus();
      });
    },
  });

  const aoFalharAbrir = useCallback(() => {
    setAdicionando(false);
    setFalhaAoAbrir(true);
  }, []);
  const Adicionar = useSobDemanda(ADICIONAR, adicionando, aoFalharAbrir);

  function abrirAdicionar() {
    setFalhaAoAbrir(false);
    setAdicionando(true);
  }

  async function aoCriar(canal) {
    // Baileys segue direto para o QR do canal novo; o oficial volta à lista.
    if (canal && canal.type === 'baileys' && canal.id) {
      navigate(`/configuracoes/canais/${canal.id}/conexao`);
      return;
    }
    setAdicionando(false);
    await refresh();
    setAviso({ titulo: 'Canal adicionado', texto: canal && canal.name ? `“${canal.name}” foi adicionado à lista.` : undefined });
  }

  function toggleShowHidden(checked) {
    const next = new URLSearchParams(searchParams);
    if (checked) next.set('ocultos', '1');
    else next.delete('ocultos');
    setSearchParams(next);
  }

  const vazia = status === 'ready' && channels.length === 0 && !showHidden;

  return (
    <SettingsShell
      areaLabel="Números conectados"
      title="Números conectados"
      iconName="canais"
      description="Gerencie os números e o atendimento de cada canal."
      width="table"
      action={canManage && <Button onClick={abrirAdicionar}>Adicionar canal</Button>}
    >
      {falhaAoAbrir && (
        <p className="cfg-canais-aviso-erro" role="alert">Não foi possível abrir o Adicionar canal. Tente de novo.</p>
      )}
      {status === 'error' ? (
        <FalhaAoCarregar onTentar={refresh} />
      ) : vazia ? (
        <ListaVazia canManage={canManage} onAdicionar={abrirAdicionar} acaoRef={vazioRef} />
      ) : (
        <AsyncState status={status} onRetry={refresh}>
          <CartoesDeCanais
            channels={channels}
            summaryContext={summaryContext}
            actions={actions}
            canManage={canManage}
            buscaRef={buscaRef}
            extraControls={
              <label className="cfg-canais-ocultos">
                <input id="mostrar-canais-ocultos" type="checkbox" checked={showHidden} onChange={(e) => toggleShowHidden(e.target.checked)} />
                Mostrar ocultos
              </label>
            }
          />
        </AsyncState>
      )}

      {actions.dialogo}
      {adicionando && Adicionar && <Adicionar onClose={() => setAdicionando(false)} onCreated={aoCriar} />}
      <AvisoDeSucesso aviso={aviso} onFechar={fecharAviso} />
    </SettingsShell>
  );
}

export default ChannelsListPage;
