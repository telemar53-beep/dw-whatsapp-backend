import { useAuth } from '../contexts/AuthContext';
import { agentAvatarUrl } from '../services/api';

function initialFor(name) {
  const trimmed = name ? name.trim() : '';
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function AgentAvatar({ agentId, avatarPath, name, size = 40, shape = 'circle' }) {
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
      style={{ ...boxStyle, fontSize: Math.round(size * 0.4) }}
      className={`flex shrink-0 select-none items-center justify-center bg-wa-avatar font-medium text-wa-avatar-text ${shapeClass}`}
    >
      {initialFor(name)}
    </span>
  );
}

export default AgentAvatar;
