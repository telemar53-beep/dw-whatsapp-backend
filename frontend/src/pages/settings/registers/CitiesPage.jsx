import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import CitiesAdminTab from '../../../components/CitiesAdminTab';

function CitiesPage() {
  const [creating, setCreating] = useState(false);
  return (
    <SettingsPage title="Cidades" description="As cidades do cadastro do cliente e dos avisos por região." scope="global" action={!creating && <Button onClick={() => setCreating(true)}>Cadastrar cidade</Button>}>
      <CitiesAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default CitiesPage;
