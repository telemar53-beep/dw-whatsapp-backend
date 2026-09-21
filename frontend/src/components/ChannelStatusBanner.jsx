import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { hasLevel } from '../navigation/navItems';
import { isOfficialChannelType } from '../utils/channelTypes';
import { IconWarning } from './icons/WaIcons';

function ChannelStatusBanner() {
  const { agent } = useAuth();
  const canSeeBanner = hasLevel(agent, 'integrations');
  const { channels } = useChannels(canSeeBanner);

  if (!canSeeBanner) return null;

  // Um canal oficial (meta_cloud/360dialog) nunca entra na faixa: ele nao tem
  // conexao para cair — quem responde e a API da Meta/BSP — e ninguem atualiza
  // o status dele depois da criacao. Avisar sobre ele so ensina o admin a
  // ignorar a faixa, e ai o aviso do baileys, que e de verdade, passa batido.
  const problemChannels = channels.filter((c) => !isOfficialChannelType(c.type) && c.status !== 'connected');
  if (problemChannels.length === 0) return null;

  return (
    <div className="space-y-1 border-b border-white/10 bg-chat-canvas px-4 py-2 font-wa text-[13.5px] leading-[20px] text-chat-muted">
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
          <Link to="/configuracoes/canais" className="font-medium text-chat-text underline underline-offset-2 hover:text-chat-orange">
            ver em Configurações › Canais
          </Link>
        </p>
      ))}
    </div>
  );
}

export default ChannelStatusBanner;
