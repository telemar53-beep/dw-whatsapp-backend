import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button, Card } from '../../../components/ui';
import { useChannels } from '../../../hooks/useChannels';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import TemplatesAdminTab from '../../../components/TemplatesAdminTab';

function TemplatesPage() {
  const [creating, setCreating] = useState(false);
  const { channels, status } = useChannels(true);
  const hasOfficialChannel = channels.some((channel) => isOfficialChannelType(channel.type));

  return (
    <SettingsPage
      title="Templates"
      description="Mensagens aprovadas pela Meta para os canais oficiais."
      scope="channel"
      action={!creating && <Button onClick={() => setCreating(true)}>Cadastrar template</Button>}
    >
      <Card title="Como funciona">
        <p>
          Templates são mensagens pré-aprovadas pela Meta, usadas para iniciar
          conversas em canais oficiais (Meta Cloud) fora da janela de 24 horas —
          cadastre novos, registre templates já existentes na Meta, ou veja o
          status de aprovação dos que já foram enviados.
        </p>
      </Card>
      {!hasOfficialChannel && status === 'ready' && (
        <Card tone="warn">
          Templates só existem em canais oficiais (Meta Cloud ou 360dialog). Nenhum canal oficial cadastrado.
        </Card>
      )}
      <TemplatesAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default TemplatesPage;
