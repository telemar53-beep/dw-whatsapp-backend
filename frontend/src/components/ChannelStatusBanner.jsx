import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';

function ChannelStatusBanner() {
  const { agent } = useAuth();
  const { channels } = useChannels();

  if (agent.role !== 'admin') return null;

  const problemChannels = channels.filter((c) => c.status !== 'connected');
  if (problemChannels.length === 0) return null;

  return (
    <div className="bg-yellow-100 px-4 py-2 text-sm text-yellow-800">
      {problemChannels.map((channel) => (
        <p key={channel.id}>
          Canal <strong>{channel.name}</strong> está{' '}
          {channel.status === 'awaiting_qr' ? 'aguardando leitura do QR code' : 'desconectado'} —{' '}
          <Link to="/admin/channels" className="underline">
            ver na administração de canais
          </Link>
        </p>
      ))}
    </div>
  );
}

export default ChannelStatusBanner;
