import SettingsPage from '../SettingsPage';
import { Card, AsyncState } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { hasLevel } from '../../../navigation/navItems';
import ChannelWelcomeMessageRow from '../../../components/messages/ChannelWelcomeMessageRow';

function WelcomePage() {
  const { agent } = useAuth();
  const canEdit = hasLevel(agent, 'integrations');
  const { channels, status, refresh } = useChannels(true);
  return (
    <SettingsPage
      title="Boas-vindas"
      description="A primeira mensagem que cada canal envia ao cliente, antes de qualquer automação."
      scope="channel"
    >
      <Card title="Como funciona">
        <p>
          Enviada automaticamente para o cliente assim que ele manda a primeira mensagem em um
          canal — antes de qualquer outra automação.
        </p>
        <p className="mt-2 italic">
          Exemplo: "Olá! Bem-vindo à nossa empresa. Em instantes um atendente vai continuar o seu
          atendimento."
        </p>
      </Card>
      <Card title="Por canal" description={canEdit ? undefined : 'Salvar boas-vindas exige a permissão de Canais e Integrações.'}>
        <AsyncState status={status} onRetry={refresh} isEmpty={channels.length === 0} emptyMessage="Nenhum canal cadastrado. Crie um em Canais WhatsApp.">
          <ul className="divide-y divide-wa-border overflow-hidden rounded-[16px] border border-wa-border bg-wa-surface">
            {channels.map((channel) => (
              <ChannelWelcomeMessageRow key={channel.id} channel={channel} onSaved={refresh} readOnly={!canEdit} />
            ))}
          </ul>
        </AsyncState>
      </Card>
    </SettingsPage>
  );
}

export default WelcomePage;
