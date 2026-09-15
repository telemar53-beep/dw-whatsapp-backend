import { useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Button, Card, AsyncState } from '../../../components/ui';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useChannels } from '../../../hooks/useChannels';
import { useTemplates } from '../../../hooks/useTemplates';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import SgpIntegrationCard from '../../../components/integrations/SgpIntegrationCard';
import CreateSgpIntegrationForm from '../../../components/integrations/CreateSgpIntegrationForm';

function SgpChannelPage() {
  const { integrations, status, error, refresh } = useSgpIntegrations();
  const { channels } = useChannels();
  const { templates } = useTemplates();
  const query = useSgpQueryConfig();
  const queryStatus = query.status;
  const [creating, setCreating] = useState(false);
  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');
  const consultaDesligada = queryStatus === 'ready' && query.config.configured && !query.config.enabled;

  return (
    <SettingsPage
      title="SGP por canal"
      description="O SGP dispara mensagens pelo chat com uma chave de API por canal."
      scope="channel"
      level="integrations"
      action={!creating && <Button onClick={() => setCreating(true)}>Nova integração SGP</Button>}
    >
      {consultaDesligada && (
        <Card tone="warn" title="A Consulta ao SGP está desativada">
          <p className="text-[13.5px] text-wa-text">
            O painel na conversa e a IA não consultam o SGP enquanto ela estiver desligada. Ative em{' '}
            <Link to="/configuracoes/integracoes/sgp-consulta" className="font-medium text-wa-link underline">Consulta ao SGP</Link>.
          </p>
        </Card>
      )}
      {creating && (
        <CreateSgpIntegrationForm
          channels={channels}
          integrations={integrations}
          templates={approvedTemplates}
          onCreated={() => { setCreating(false); refresh(); }}
          onCancel={() => setCreating(false)}
        />
      )}
      <AsyncState status={status} error={error} onRetry={refresh} isEmpty={integrations.length === 0} emptyMessage="Nenhuma integração SGP por canal ainda.">
        <div className="space-y-3">
          {integrations.map((integration) => (
            <SgpIntegrationCard key={integration.id} integration={integration} channels={channels} templates={approvedTemplates} onChanged={refresh} />
          ))}
        </div>
      </AsyncState>
    </SettingsPage>
  );
}

export default SgpChannelPage;
