import { useAuth } from '../contexts/AuthContext';
import { agentAvatarUrl } from '../services/api';

// "Ana Oliveira" vira AO; um nome só vira a primeira letra.
function initialFor(name) {
  const trimmed = name ? name.trim() : '';
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return `${words[0].charAt(0)}${last}`.toUpperCase();
}

// Uma cor por pessoa, estável pelo nome: numa tabela de usuários cada linha
// se distingue de longe sem precisar de foto.
const TONES = ['bg-[#7c5cff]', 'bg-[#2f7cf6]', 'bg-[#e0459b]', 'bg-[#1f9d5a]', 'bg-[#d97a1f]', 'bg-[#0ea5b7]'];
function toneFor(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

function AgentAvatar({ agentId, avatarPath, name, size = 40, shape = 'circle', colorful = false }) {
  const { token } = useAuth();
  const boxStyle = { width: size, height: size };
  const shapeClass = shape === 'square' ? 'rounded-[14px]' : 'rounded-full';

  if (avatarPath) {
    return (
      <img
        key={avatarPath}
        src={agentAvatarUrl(agentId, token)}
        alt={name || 'Atendente'}
        style={boxStyle}
        className={`shrink-0 bg-wa-avatar object-cover ${shapeClass}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...boxStyle, fontSize: Math.round(size * (colorful ? 0.36 : 0.4)) }}
      className={`flex shrink-0 select-none items-center justify-center font-medium ${shapeClass} ${
        colorful ? `${toneFor(name)} font-semibold text-white` : 'bg-wa-avatar text-wa-avatar-text'
      }`}
    >
      {initialFor(name)}
    </span>
  );
}

export default AgentAvatar;
