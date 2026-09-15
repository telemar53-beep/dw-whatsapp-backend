import { Card } from '../../../components/ui';
import { useChannels } from '../../../hooks/useChannels';
import { isOfficialChannelType } from '../../../utils/channelTypes';
import TemplatesAdminTab from '../../../components/TemplatesAdminTab';

// A barra de ferramentas, a lista e a prévia são do TemplatesAdminTab; aqui só
// entra o aviso de que templates exigem canal oficial.
function TemplatesPage() {
  const { channels, status } = useChannels(true);
  const hasOfficialChannel = channels.some((channel) => isOfficialChannelType(channel.type));

  return (
    <>
      {!hasOfficialChannel && status === 'ready' && (
        <Card tone="warn">
          Templates só existem em canais oficiais (Meta Cloud ou 360dialog). Nenhum canal oficial cadastrado.
        </Card>
      )}
      <TemplatesAdminTab />
    </>
  );
}

export default TemplatesPage;
