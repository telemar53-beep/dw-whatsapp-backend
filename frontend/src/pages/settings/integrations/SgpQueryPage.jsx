import { Link } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import SgpQueryConfigCard from '../../../components/SgpQueryConfigCard';
import { IconChats, IconUser, IconFile, IconInfo } from '../../../components/icons/WaIcons';

const USES = [
  { icon: IconChats, label: 'Consulta durante o atendimento' },
  { icon: IconUser, label: 'Identificação do cliente pela IA' },
  { icon: IconFile, label: 'Consulta de contratos e faturas' },
];

function SgpQueryPage() {
  return (
    <ProtectedRoute level="integrations" areaLabel="Consulta ao SGP">
      <div className="settings-service-detail grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SgpQueryConfigCard />
        <div className="space-y-4">
          <section className="rounded-[14px] border border-wa-border bg-black/[0.12] px-4 py-4 sm:px-5">
            <h3 className="text-[15px] font-semibold text-wa-text">Onde esta integração é usada</h3>
            <ul className="mt-3 space-y-3">
              {USES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-[13.5px] text-wa-text">
                  <span className="text-wa-muted">
                    <Icon size={18} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </section>
          <p className="flex items-start gap-2.5 rounded-[12px] border border-wa-border bg-white/[0.03] px-4 py-3 text-[12.5px] leading-[18px] text-wa-muted">
            <span className="mt-0.5 shrink-0">
              <IconInfo size={15} />
            </span>
            <span>
              As ações permitidas para a IA são definidas em Automação e IA.{' '}
              <Link to="/configuracoes/automacao/ferramentas" className="font-medium text-chat-orange hover:underline">
                Ver ações permitidas →
              </Link>
            </span>
          </p>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default SgpQueryPage;
