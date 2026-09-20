import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { avatarUrl } from '../services/api';

// "Mariana Costa" vira MC; um nome só vira a primeira letra; sem nome, o
// primeiro dígito do telefone. Duas letras identificam melhor numa lista longa.
function initialFor(displayName, phoneNumber) {
  const trimmedName = displayName ? displayName.trim() : '';
  if (trimmedName) {
    const words = trimmedName.split(/\s+/).filter(Boolean);
    const first = words[0].charAt(0);
    const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
    return `${first}${last}`.toUpperCase();
  }
  if (phoneNumber) {
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (digitsOnly) return digitsOnly.charAt(0);
  }
  return '?';
}

// `dark` troca o disco claro do WhatsApp pelo disco laranja→cobre da página de
// atendimento (a mesma cor dos botões, para o avatar pertencer ao tema).
function ContactAvatar({ contactId, avatarPath, displayName, phoneNumber, size = 40, dark = false }) {
  const { token } = useAuth();
  const [failedPath, setFailedPath] = useState(null);
  const boxStyle = { width: size, height: size };

  if (avatarPath && failedPath !== avatarPath) {
    return (
      <img
        src={avatarUrl(contactId, token, avatarPath)}
        alt={displayName || phoneNumber || 'Contato'}
        onError={() => setFailedPath(avatarPath)}
        style={boxStyle}
        className={`shrink-0 rounded-full object-cover ${dark ? 'bg-white/[0.13]' : 'bg-wa-avatar'}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...boxStyle, fontSize: Math.round(size * 0.34) }}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[0.01em] ${
        dark
          ? 'bg-[linear-gradient(135deg,var(--color-chat-orange),var(--color-chat-copper))] text-white'
          : 'bg-wa-avatar font-medium text-wa-avatar-text'
      }`}
    >
      {initialFor(displayName, phoneNumber)}
    </span>
  );
}

export default ContactAvatar;
