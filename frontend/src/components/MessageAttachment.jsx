import { useAuth } from '../contexts/AuthContext';
import { mediaUrl } from '../services/api';

function MessageAttachment({ message }) {
  const { token } = useAuth();

  if (message.messageType === 'location') {
    const mapsUrl = `https://www.google.com/maps?q=${message.locationLatitude},${message.locationLongitude}`;
    return (
      <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
        Ver localização no mapa
      </a>
    );
  }

  if (!message.mediaPath) return null;

  const url = mediaUrl(message.id, token);

  if (message.messageType === 'image' || message.messageType === 'sticker') {
    return <img src={url} alt={message.mediaFilename || 'Imagem'} className="max-w-xs rounded" />;
  }
  if (message.messageType === 'audio') {
    return <audio controls src={url} className="max-w-xs" />;
  }
  if (message.messageType === 'video') {
    return <video controls src={url} className="max-w-xs rounded" />;
  }
  if (message.messageType === 'document') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
        📄 {message.mediaFilename || 'Documento'}
      </a>
    );
  }
  return null;
}

export default MessageAttachment;
