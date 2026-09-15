import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import TriageAdminTab from '../../../components/TriageAdminTab';

function MenuTriagePage() {
  const [creating, setCreating] = useState(false);

  return (
    <SettingsPage
      title="Triagem por menu"
      description="O menu numerado que o cliente recebe antes de falar com um atendente."
      scope="channel"
      action={!creating && <Button onClick={() => setCreating(true)}>Criar opção</Button>}
    >
      <TriageAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default MenuTriagePage;
