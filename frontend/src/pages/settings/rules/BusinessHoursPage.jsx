import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card } from '../../../components/ui';
import BusinessHoursSection from '../../../components/messages/BusinessHoursSection';

function BusinessHoursPage() {
  return (
    <SettingsPage title="Horário de atendimento" description="Quando há atendente humano e o aviso fora do expediente." scope="global">
      <Card title="Horário humano × noturno da IA">
        <p>
          Este horário define quando há atendente humano. A janela em que a IA
          atende sozinha à noite é outra configuração:{' '}
          <Link to="/configuracoes/automacao/noturno" className="font-medium text-wa-link hover:text-wa-link/80 hover:underline">
            Automação e IA › Atendimento noturno
          </Link>
          .
        </p>
      </Card>
      <BusinessHoursSection />
    </SettingsPage>
  );
}

export default BusinessHoursPage;
