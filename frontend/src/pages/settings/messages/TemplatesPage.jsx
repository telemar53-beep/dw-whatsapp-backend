import SettingsPage from '../SettingsPage';
import { Card } from '../../../components/ui';
import { useChannels } from '../../../hooks/useChannels';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import TemplatesAdminTab from '../../../components/TemplatesAdminTab';

function TemplatesPage() {
  const { channels, loading, status: hookStatus } = useChannels(true);
  const status = hookStatus || (loading ? 'loading' : 'ready');
  const hasOfficialChannel = channels.some((channel) => isOfficialChannelType(channel.type));

  return (
    <SettingsPage title="Templates" description="Mensagens aprovadas pela Meta para os canais oficiais." scope="channel">
      {!hasOfficialChannel && status === 'ready' && (
        <Card tone="warn">
          Templates só existem em canais oficiais (Meta Cloud ou 360dialog). Nenhum canal oficial cadastrado.
        </Card>
      )}
      <TemplatesAdminTab />
    </SettingsPage>
  );
}

export default TemplatesPage;
