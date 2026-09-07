import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/api';

function QrCodeView({ channel, onRefresh }) {
  const { token } = useAuth();

  if (channel.status !== 'awaiting_qr') return null;

  const qrUrl = `${API_BASE_URL}/api/admin/channels/${channel.id}/qr?token=${token}`;

  return (
    <div className="mt-3 rounded-xl border border-dashed border-ink-950/15 bg-white/40 p-3 text-center">
      <p className="mb-2 text-sm text-ink-950/60">Escaneie o QR code no WhatsApp: {channel.name}</p>
      <iframe title={`QR - ${channel.name}`} src={qrUrl} className="mx-auto h-64 w-64 rounded-lg border-0 bg-white" />
      <button onClick={onRefresh} className="mt-2 text-sm font-medium text-teal-signal hover:text-teal-signal/80 hover:underline">
        Atualizar
      </button>
    </div>
  );
}

export default QrCodeView;
