import { Link } from 'react-router-dom';
import { IconLock } from '../components/icons/WaIcons';

const LEVEL_TEXT = {
  admin: 'Esta área é liberada para administradores e gerentes.',
  integrations:
    'Esta área é liberada para administradores e para gerentes com a permissão "Pode gerenciar Canais e Integrações", marcada na conta pelo administrador.',
};

function AccessDeniedPage({ areaLabel = 'esta área', level = 'admin' }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-chat-orange">
        <IconLock size={22} />
      </span>
      <h1 className="font-display text-[24px] font-semibold text-chat-text">Sem acesso a {areaLabel}</h1>
      <p className="mt-2 max-w-[44ch] text-[14px] leading-[20px] text-chat-muted">{LEVEL_TEXT[level] || LEVEL_TEXT.admin}</p>
      <Link
        to="/"
        className="mt-6 rounded-full bg-chat-orange px-5 py-2.5 text-[14px] font-medium text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chat-orange"
      >
        Ir para o Atendimento
      </Link>
    </div>
  );
}

export default AccessDeniedPage;
