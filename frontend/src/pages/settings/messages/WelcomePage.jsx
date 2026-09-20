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
    <div className="settings-message-library">
      <div className="border-b border-wa-border pb-4 text-[13.5px] leading-5 text-wa-muted">
        <p>A mensagem é enviada após o primeiro contato do cliente, antes das outras automações.</p>
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-chat-orange">Ver exemplo</summary>
          <p className="mt-2 italic">“Olá! Bem-vindo à nossa empresa. Em instantes um atendente vai continuar o seu atendimento.”</p>
        </details>
      </div>
      <Card title="Por canal" description={canEdit ? undefined : 'Salvar boas-vindas exige a permissão de Canais e Integrações.'}>
        <AsyncState status={status} onRetry={refresh} isEmpty={channels.length === 0} emptyMessage="Nenhum canal cadastrado. Crie um em Canais WhatsApp.">
          <ul className="divide-y divide-wa-border overflow-hidden rounded-[16px] border border-wa-border bg-wa-surface">
            {channels.map((channel) => (
              <ChannelWelcomeMessageRow key={channel.id} channel={channel} onSaved={refresh} readOnly={!canEdit} />
            ))}
          </ul>
        </AsyncState>
      </Card>
    </div>
  );
}

export default WelcomePage;
