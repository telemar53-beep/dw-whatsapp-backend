import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import AgentsAdminTab from '../../../components/AgentsAdminTab';

function UsersPage() {
  const [creating, setCreating] = useState(false);
  return (
    <SettingsPage
      title="Usuários"
      description="Quem entra no sistema: atendentes, gerentes e administradores."
      scope="global"
      action={!creating && <Button onClick={() => setCreating(true)}>Criar usuário</Button>}
    >
      <AgentsAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default UsersPage;
