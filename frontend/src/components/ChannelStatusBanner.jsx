import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { useSocket } from '../contexts/SocketContext';
import { hasLevel } from '../navigation/navItems';
import { isOfficialChannelType } from '../utils/channelTypes';
import { IconWarning } from './icons/WaIcons';

function ChannelStatusBanner() {
  const { agent } = useAuth();
  const canSeeBanner = hasLevel(agent, 'integrations');
  const { channels, status, refresh } = useChannels(canSeeBanner);
  const socket = useSocket();

  // A faixa não se atualizava no turno (CAS-BAN): busca de novo quando o socket
  // volta e quando a aba volta a ficar visível — não há evento de status de canal.
  useEffect(() => {
    if (!canSeeBanner || typeof refresh !== 'function') return undefined;
    const aoVoltarAba = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', aoVoltarAba);
    if (socket) socket.on('connect', refresh);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltarAba);
      if (socket) socket.off('connect', refresh);
    };
  }, [canSeeBanner, socket, refresh]);

  if (!canSeeBanner) return null;

  // Um canal oficial (meta_cloud/360dialog) nunca entra na faixa: ele nao tem
  // conexao para cair — quem responde e a API da Meta/BSP — e ninguem atualiza
  // o status dele depois da criacao. Avisar sobre ele so ensina o admin a
  // ignorar a faixa, e ai o aviso do baileys, que e de verdade, passa batido.
  const problemChannels = channels.filter((c) => !isOfficialChannelType(c.type) && c.status !== 'connected');
  // Falha ao buscar parecia "tudo conectado": a faixa simplesmente não aparecia.
  const falhou = status === 'error';
  const temAviso = falhou || problemChannels.length > 0;

  // A região viva fica sempre montada (mudo para leitor de tela antes: o aviso
  // nascia junto com o texto). `aria-live` sem role="status" — um status por tela.
  return (
    <div aria-live="polite" className={temAviso ? 'space-y-1 border-b border-white/10 bg-chat-canvas px-4 py-2 font-wa text-[13.5px] leading-[20px] text-chat-muted' : undefined}>
      {falhou && (
        <p>
          <span className="mr-2 inline-flex align-middle text-chat-orange">
            <IconWarning size={16} />
          </span>
          Não foi possível conferir os canais —{' '}
          <button type="button" onClick={refresh} className="font-medium text-chat-text underline underline-offset-2 hover:text-chat-orange">
            Tentar de novo
          </button>
        </p>
      )}
      {problemChannels.map((channel) => (
        // Texto corrido, NÃO flex: com `display:flex` no parágrafo cada trecho
        // de texto entre os elementos virava um item flex anônimo, e como o
        // padrão é `nowrap` a frase se quebrava em colunas justapostas em vez
        // de em linhas. A 360 e a 430px a faixa ficava 3x mais alta (20px ->
        // 60px) e o link caía numa coluna de 97px, em três linhas. O ícone
        // volta a ser um ícone no meio da frase.
        <p key={channel.id}>
          <span className="mr-2 inline-flex align-middle text-chat-orange">
            <IconWarning size={16} />
          </span>
          Canal <strong className="font-semibold text-chat-text">{channel.name}</strong> está{' '}
          {channel.status === 'awaiting_qr' ? 'aguardando leitura do QR code' : 'desconectado'} —{' '}
          {/* Antes: link para a LISTA, com um caminho como rótulo. Agora vai ao canal. */}
          <Link to={`/configuracoes/canais/${channel.id}`} className="font-medium text-chat-text underline underline-offset-2 hover:text-chat-orange">
            Conectar
          </Link>
        </p>
      ))}
    </div>
  );
}

export default ChannelStatusBanner;
