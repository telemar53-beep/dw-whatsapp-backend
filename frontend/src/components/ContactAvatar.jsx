import { useCallback, useState } from 'react';
import { useMediaResourceUrl } from '../hooks/useMediaResourceUrl';
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
  const [failedPath, setFailedPath] = useState(null);
  const construir = useCallback(
    (mediaToken) => avatarUrl(contactId, mediaToken, avatarPath),
    [contactId, avatarPath]
  );
  const { url, tentarDeNovo, pronto } = useMediaResourceUrl(construir);
  const boxStyle = { width: size, height: size };

  if (avatarPath && failedPath !== avatarPath && pronto) {
    return (
      <img
        src={url}
        alt={displayName || phoneNumber || 'Contato'}
        // A URL foi montada no mount e o token pode ter vencido desde entao.
        // Refaz UMA vez com o token atual; se falhar de novo, cai nas iniciais.
        onError={() => { if (!tentarDeNovo()) setFailedPath(avatarPath); }}
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
          // Tinta escura sobre o gradiente laranja: branco dava 2,30:1, longe
          // do 4,5:1 de AA, e este avatar aparece na lista, no cabeçalho da
          // conversa, nas linhas da Supervisão e no popup da equipe. O token
          // `chat-orange-ink` existe para isto e dá 7,22:1. O disco e o
          // gradiente não mudam — só a tinta das iniciais.
          ? 'bg-[linear-gradient(135deg,var(--color-chat-orange),var(--color-chat-copper))] text-chat-orange-ink'
          : 'bg-wa-avatar font-medium text-wa-avatar-text'
      }`}
    >
      {initialFor(displayName, phoneNumber)}
    </span>
  );
}

export default ContactAvatar;
