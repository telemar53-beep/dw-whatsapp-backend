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

function ContactAvatar({ contactId, avatarPath, displayName, phoneNumber }) {
  const { token } = useAuth();

  if (avatarPath) {
    return (
      <img
        src={avatarUrl(contactId, token)}
        alt={displayName || phoneNumber || 'Contato'}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
      {initialFor(displayName, phoneNumber)}
    </span>
  );
}

export default ContactAvatar;
