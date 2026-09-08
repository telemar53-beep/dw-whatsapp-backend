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

function ContactAvatar({ contactId, avatarPath, displayName, phoneNumber, size = 40 }) {
  const { token } = useAuth();
  const boxStyle = { width: size, height: size };

  if (avatarPath) {
    return (
      <img
        src={avatarUrl(contactId, token)}
        alt={displayName || phoneNumber || 'Contato'}
        style={boxStyle}
        className="shrink-0 rounded-full bg-[#dfe5e7] object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...boxStyle, fontSize: Math.round(size * 0.4) }}
      className="flex shrink-0 select-none items-center justify-center rounded-full bg-[#dfe5e7] font-medium text-[#8696a0]"
    >
      {initialFor(displayName, phoneNumber)}
    </span>
  );
}

export default ContactAvatar;
