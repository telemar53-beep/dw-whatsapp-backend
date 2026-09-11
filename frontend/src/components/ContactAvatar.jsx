import { useAuth } from '../contexts/AuthContext';
import { avatarUrl } from '../services/api';

function initialFor(displayName, phoneNumber) {
  const trimmedName = displayName ? displayName.trim() : '';
  if (trimmedName) return trimmedName.charAt(0).toUpperCase();
  if (phoneNumber) {
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (digitsOnly) return digitsOnly.charAt(0);
  }
  return '?';
}

// `dark` troca o disco claro do WhatsApp pelo vidro fumê da página de atendimento.
function ContactAvatar({ contactId, avatarPath, displayName, phoneNumber, size = 40, dark = false }) {
  const { token } = useAuth();
  const boxStyle = { width: size, height: size };
  const discClass = dark ? 'bg-white/[0.13]' : 'bg-wa-avatar';

  if (avatarPath) {
    return (
      <img
        src={avatarUrl(contactId, token, avatarPath)}
        alt={displayName || phoneNumber || 'Contato'}
        style={boxStyle}
        className={`shrink-0 rounded-full object-cover ${discClass}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...boxStyle, fontSize: Math.round(size * 0.38) }}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-medium ${discClass} ${
        dark ? 'text-chat-muted' : 'text-wa-avatar-text'
      }`}
    >
      {initialFor(displayName, phoneNumber)}
    </span>
  );
}

export default ContactAvatar;
