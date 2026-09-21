import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import BusinessHoursSection from '../../../components/messages/BusinessHoursSection';

function BusinessHoursPage() {
  return (
    <SettingsPage title="Horário de atendimento" description="Quando há atendente humano e o aviso fora do expediente." scope="global">
      <p className="settings-intro border-b border-wa-border pb-4 text-[13.5px] leading-5 text-wa-muted">
        Este horário controla a disponibilidade humana. Para a janela da IA à noite, acesse{' '}
        <Link to="/configuracoes/automacao/noturno" className="font-medium text-wa-link hover:text-wa-link/80 hover:underline">
          Atendimento noturno
        </Link>.
      </p>
      <BusinessHoursSection />
    </SettingsPage>
  );
}

export default BusinessHoursPage;
