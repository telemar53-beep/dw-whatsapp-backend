import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { IconWarning } from './icons/WaIcons';

function ChannelStatusBanner() {
  const { agent } = useAuth();
  const isAdmin = agent?.role === 'admin';
  const { channels } = useChannels(isAdmin);

  if (!isAdmin) return null;

  const problemChannels = channels.filter((c) => c.status !== 'connected');
  if (problemChannels.length === 0) return null;

  return (
    <div className="border-b border-[#f2d99a] bg-[#fff3cd] px-4 py-2 font-wa text-[13.5px] leading-[20px] text-[#7a5c15]">
      {problemChannels.map((channel) => (
        <p key={channel.id} className="flex items-center gap-2">
          <span className="shrink-0 text-[#c9962c]">
            <IconWarning size={16} />
          </span>
          Canal <strong className="font-semibold">{channel.name}</strong> está{' '}
          {channel.status === 'awaiting_qr' ? 'aguardando leitura do QR code' : 'desconectado'} —{' '}
          <Link to="/admin/channels" className="font-medium underline underline-offset-2 hover:text-[#5c440d]">
            ver na administração de canais
          </Link>
        </p>
      ))}
    </div>
  );
}

export default ChannelStatusBanner;
