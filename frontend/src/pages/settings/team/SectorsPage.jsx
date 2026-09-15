import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import SectorsAdminTab from '../../../components/SectorsAdminTab';

function SectorsPage() {
  const [creating, setCreating] = useState(false);
  return (
    <SettingsPage title="Setores" description="Os times para onde um atendimento pode ir. A orientação para a IA ajuda a triagem a escolher o setor certo." scope="global" action={!creating && <Button onClick={() => setCreating(true)}>Cadastrar setor</Button>}>
      <SectorsAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default SectorsPage;
