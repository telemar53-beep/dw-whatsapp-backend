import './detalhe-do-canal.css';
import { useCallback, useState } from 'react';
import { useParams, Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { AsyncState } from '../../../components/ui';
import { useChannels } from '../../../hooks/useChannels';
import { SETTINGS_BASE } from '../../../navigation/navItems';
import { formatPhone } from '../../../utils/phone';
import { sobDemanda, useSobDemanda } from '../../../utils/sobDemanda';
import { useChannelActions } from './useChannelActions';
import { ConnectionStatus, providerLabel } from './ChannelsTable';
import { EmblemaDoCanal } from './emblema';
import { AvisoDeSucesso } from './AvisoDeSucesso';
import SettingsShell from '../SettingsShell';

// Detalhe do canal (Fatia S2, primeiro mockup).
//
// - O título é o nome do canal, com o emblema do tipo e o estado ao lado;
//   "Números conectados" é o caminho de volta (e a trilha), não um título
//   repetido. Saiu o seletor "Trocar de canal".
// - Duas abas: Conexão (estado, QR, identificação e ações do canal) e
//   Atendimento (automações deste canal).
// - É página de quem gerencia integrações: o gerente sem a permissão vê "Sem
//   acesso a este canal" e nada daqui monta — nem o QR, que respondia 403.
// - Excluir, concluído, volta para a lista com a confirmação, em vez de
//   terminar em "Canal não encontrado".
// - Migrar para Meta Cloud e Atualizar credenciais abrem um diálogo que só
//   chega quando é aberto.
const CREDENCIAIS = sobDemanda(() => import('./CredenciaisMetaDialog'));

const LISTA = '/configuracoes/canais';

const AVISOS = {
  ocultar: (canal) => ({ titulo: 'Canal ocultado', texto: `“${canal.name}” saiu da lista. Nada foi apagado.` }),
  reexibir: (canal) => ({ titulo: 'Canal reexibido', texto: `“${canal.name}” voltou para a lista.` }),
  reconectar: () => ({ titulo: 'Novo QR code gerado', texto: 'Leia o código em Conexão para voltar a receber mensagens.' }),
};

function ChannelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { channels, status, refresh } = useChannels(true, true);
  const channel = channels.find((c) => c.id === id);
  const [aviso, setAviso] = useState(null);
  const [credenciais, setCredenciais] = useState(null);
  const [falhaAoAbrir, setFalhaAoAbrir] = useState(false);
  const fecharAviso = useCallback(() => setAviso(null), []);

  const actions = useChannelActions(refresh, {
    aoConcluir: (tipo, canal) => {
      if (tipo === 'excluir') {
        navigate(LISTA, { state: { aviso: { titulo: 'Canal excluído', texto: `“${canal.name}” foi removido da lista.` } } });
        return;
      }
      setAviso(AVISOS[tipo](canal));
    },
  });

  const aoFalharAbrir = useCallback(() => {
    setCredenciais(null);
    setFalhaAoAbrir(true);
  }, []);
  const Credenciais = useSobDemanda(CREDENCIAIS, Boolean(credenciais), aoFalharAbrir);

  function abrirCredenciais(modo) {
    setFalhaAoAbrir(false);
    setCredenciais(modo);
  }

  // Na trilha, "Números conectados" é texto: o link para a lista é o voltar
  // logo abaixo (dois links iguais seguidos só repetiriam o leitor de tela).
  const trilha = [
    { label: 'Configurações', to: SETTINGS_BASE },
    { label: 'Números conectados' },
    ...(channel ? [{ label: channel.name }] : []),
  ];

  return (
    <SettingsShell
      level="integrations"
      areaLabel="este canal"
      trilha={trilha}
      voltar={{ to: LISTA, rotulo: 'Números conectados' }}
      semAcesso={{
        titulo: 'Sem acesso a este canal',
        texto: 'Seu perfil pode ver a lista, mas não pode consultar credenciais, QR code nem configurações de integração.',
        voltar: { to: LISTA, rotulo: 'Voltar aos canais' },
      }}
      title={channel ? channel.name : 'Canal'}
      description={channel ? `${formatPhone(channel.phoneNumber)} · ${providerLabel(channel.type)}` : null}
      marca={channel ? <EmblemaDoCanal type={channel.type} /> : undefined}
      action={channel ? <ConnectionStatus channel={channel} comQualidade /> : undefined}
      iconName="canais"
      width="wide"
    >
      <AsyncState status={status} onRetry={refresh}>
        {!channel ? (
          <p className="cfg-detalhe-ausente">
            Canal não encontrado.{' '}
            <Link to={LISTA}>Voltar para a lista</Link>
          </p>
        ) : (
          <div className="cfg-detalhe cfg-s2">
            <nav aria-label="Seções do canal" className="cfg-abas">
              <NavLink to={`/configuracoes/canais/${channel.id}/conexao`} className="cfg-aba">Conexão</NavLink>
              <NavLink to={`/configuracoes/canais/${channel.id}/atendimento`} className="cfg-aba">Atendimento</NavLink>
            </nav>
            {falhaAoAbrir && <p className="cfg-detalhe-erro" role="alert">Não foi possível abrir as credenciais. Tente de novo.</p>}
            <Outlet context={{ channel, refresh, actions, abrirCredenciais, avisar: setAviso }} />
          </div>
        )}
      </AsyncState>
      {actions.dialogo}
      {credenciais && Credenciais && channel && (
        <Credenciais
          modo={credenciais}
          canal={channel}
          onClose={() => setCredenciais(null)}
          onSalvar={(dados) => actions.salvarCredenciaisMeta(channel.id, dados)}
          onConcluido={() => {
            setAviso(credenciais === 'migrar'
              ? { titulo: 'Canal migrado para Meta Cloud', texto: `“${channel.name}” agora usa a conexão oficial da Meta.` }
              : { titulo: 'Credenciais atualizadas', texto: 'A Meta conferiu os dados antes de salvar.' });
            setCredenciais(null);
          }}
        />
      )}
      <AvisoDeSucesso aviso={aviso} onFechar={fecharAviso} />
    </SettingsShell>
  );
}

export default ChannelDetailPage;
