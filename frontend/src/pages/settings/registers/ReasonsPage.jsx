import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import ReasonsAdminTab from '../../../components/ReasonsAdminTab';
import { useAiConfig } from '../../../hooks/useAiConfig';

function ReasonsPage() {
  const [creating, setCreating] = useState(false);
  const { config } = useAiConfig();
  return (
    <SettingsPage title="Motivos de atendimento" description="O motivo que o atendente escolhe ao encerrar. Aparece agrupado em Relatórios." scope="global" action={!creating && <Button onClick={() => setCreating(true)}>Criar motivo</Button>}>
      <ReasonsAdminTab creating={creating} onCreatingChange={setCreating} aiResolvedReasonId={config.triageResolvedReasonId || null} />
    </SettingsPage>
  );
}

export default ReasonsPage;
