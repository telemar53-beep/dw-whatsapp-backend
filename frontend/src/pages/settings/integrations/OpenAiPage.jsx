import { Link } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import OpenAiConfigCard from '../../../components/OpenAiConfigCard';
import { IconBrain, IconLock } from '../../../components/icons/WaIcons';

const USERS = [
  { label: 'Atendimento e triagem com IA', to: '/configuracoes/automacao/ia' },
  { label: 'Transcrição de áudio', to: '/configuracoes/automacao/transcricao' },
  { label: 'Atendimento noturno', to: '/configuracoes/automacao/noturno' },
];

function OpenAiPage() {
  return (
    <ProtectedRoute level="integrations" areaLabel="OpenAI">
      <section
        aria-labelledby="openai-integration-title"
        className="overflow-clip rounded-[16px] border border-wa-surface-line bg-wa-surface backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-wa-border px-4 pb-4 pt-5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-wa-border bg-white/[0.05] text-wa-text">
              <IconBrain size={24} />
            </span>
            <div className="min-w-0">
              <h2 id="openai-integration-title" className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">
                OpenAI
              </h2>
              <p className="mt-0.5 text-[13px] text-wa-muted">Credencial, modelo e teste de conexão da IA.</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-wa-border bg-white/[0.05] px-3 py-1.5 text-[12.5px] text-wa-muted">
            <IconLock size={13} />
            Acesso a credenciais restrito
          </span>
        </div>
        <div className="grid gap-4 px-4 py-5 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <OpenAiConfigCard />
          <section className="self-start rounded-[14px] border border-wa-border bg-black/[0.12] px-4 py-4 sm:px-5">
            <h3 className="text-[15px] font-semibold text-wa-text">Usa esta conexão</h3>
            <p className="mt-1 text-[12.5px] text-wa-muted">Estas automações só funcionam com a OpenAI conectada.</p>
            <ul className="mt-3 space-y-2 text-[13.5px]">
              {USERS.map((u) => (
                <li key={u.to}>
                  <Link to={u.to} className="text-wa-link hover:underline">
                    {u.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </ProtectedRoute>
  );
}

export default OpenAiPage;
