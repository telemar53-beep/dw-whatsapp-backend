import SettingsPage from './SettingsPage';
import { Card } from '../../components/ui';
import CompanyConfigCard from '../../components/CompanyConfigCard';
import { useCompanyConfig } from '../../hooks/useCompanyConfig';

function CompanyPage() {
  const { config, status } = useCompanyConfig();
  const semNomes = status === 'ready' && (!config.acceptedPayeeNames || config.acceptedPayeeNames.length === 0);
  return (
    <SettingsPage title="Empresa" description="Nome da empresa e nomes aceitos na conferência de comprovantes." scope="global">
      {semNomes && (
        <Card tone="warn" title="Sem nomes aceitos, nenhum comprovante confere">
          <p className="text-[13.5px] text-wa-text">A IA compara o favorecido do comprovante com esta lista. Cadastre pelo menos a razão social e o nome fantasia.</p>
        </Card>
      )}
      <CompanyConfigCard />
    </SettingsPage>
  );
}

export default CompanyPage;
