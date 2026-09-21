import { Link } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import OpenAiConfigCard from '../../../components/OpenAiConfigCard';
import { IconLock } from '../../../components/icons/WaIcons';

const USERS = [
  { label: 'Atendimento e triagem com IA', to: '/configuracoes/automacao/ia' },
  { label: 'Transcrição de áudio', to: '/configuracoes/automacao/transcricao' },
  { label: 'Atendimento noturno', to: '/configuracoes/automacao/noturno' },
];

function OpenAiPage() {
  return (
    <ProtectedRoute level="integrations" areaLabel="OpenAI">
      <div className="space-y-4">
        <p className="inline-flex items-center gap-1.5 text-[12.5px] text-wa-muted"><IconLock size={13} /> Acesso a credenciais restrito</p>
        <div className="settings-service-detail grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <OpenAiConfigCard />
          <section className="settings-service-aside self-start rounded-[14px] border border-wa-border bg-black/[0.12] px-4 py-4 sm:px-5">
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
      </div>
    </ProtectedRoute>
  );
}

export default OpenAiPage;
