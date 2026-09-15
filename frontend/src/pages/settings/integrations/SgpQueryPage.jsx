import SettingsPage from '../SettingsPage';
import SgpQueryConfigCard from '../../../components/SgpQueryConfigCard';

function SgpQueryPage() {
  return (
    <SettingsPage
      title="Consulta ao SGP"
      description="O chat consulta cliente, contrato e fatura no SGP: painel na conversa e ferramentas da IA."
      scope="global"
      level="integrations"
    >
      <SgpQueryConfigCard />
    </SettingsPage>
  );
}

export default SgpQueryPage;
