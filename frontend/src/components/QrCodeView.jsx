import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../services/api';

function QrCodeView({ channel, onRefresh }) {
  const { token } = useAuth();

  if (channel.status !== 'awaiting_qr') return null;

  const qrUrl = `${API_BASE_URL}/api/admin/channels/${channel.id}/qr?token=${token}`;

  return (
    <div className="rounded border border-gray-200 p-3 text-center">
      <p className="mb-2 text-sm text-gray-600">Escaneie o QR code no WhatsApp: {channel.name}</p>
      <iframe title={`QR - ${channel.name}`} src={qrUrl} className="mx-auto h-64 w-64 border-0" />
      <button onClick={onRefresh} className="mt-2 text-sm text-blue-600 underline">
        Atualizar
      </button>
    </div>
  );
}

export default QrCodeView;
