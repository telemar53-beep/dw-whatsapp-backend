import { useState } from 'react';
import { Link } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { Button, Card, AsyncState } from '../../../components/ui';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useChannels } from '../../../hooks/useChannels';
import { useTemplates } from '../../../hooks/useTemplates';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import SgpIntegrationCard from '../../../components/integrations/SgpIntegrationCard';
import CreateSgpIntegrationForm from '../../../components/integrations/CreateSgpIntegrationForm';
import { SegredoGeradoDialog } from '../../../components/ui/SegredoGeradoDialog';

function SgpChannelPage() {
  const { integrations, status, error, refresh } = useSgpIntegrations();
  const { channels } = useChannels();
  const { templates } = useTemplates();
  const query = useSgpQueryConfig();
  const queryStatus = query.status;
  const [creating, setCreating] = useState(false);
  // A chave recém-gerada mora aqui, e não no cartão: se a releitura da lista
  // falhar, o AsyncState troca os cartões por um erro — e a chave, que só
  // aparece uma vez, iria junto (Fatia S0).
  const [chaveGerada, setChaveGerada] = useState(null);
  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');
  const consultaDesligada = queryStatus === 'ready' && query.config.configured && !query.config.enabled;

  return (
    <ProtectedRoute level="integrations" areaLabel="SGP por canal">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[60ch] text-[13.5px] leading-[19px] text-wa-muted">
            O SGP dispara mensagens pelo chat com uma chave de API por canal.
          </p>
          {!creating && (
            <Button onClick={() => setCreating(true)} className="!py-2">
              Nova integração SGP
            </Button>
          )}
        </div>
        {consultaDesligada && (
          <Card tone="warn" title="A Consulta ao SGP está desativada">
            <p className="text-[13.5px] text-wa-text">
              O painel na conversa e a IA não consultam o SGP enquanto ela estiver desligada. Ative em{' '}
              <Link to="/configuracoes/integracoes/sgp/consultas" className="font-medium text-wa-link underline">
                Consulta ao SGP
              </Link>
              .
            </p>
          </Card>
        )}
        {creating && (
          <CreateSgpIntegrationForm
            channels={channels}
            integrations={integrations}
            templates={approvedTemplates}
            onCreated={() => {
              setCreating(false);
              refresh();
            }}
            onCancel={() => setCreating(false)}
          />
        )}
        <AsyncState
          status={status}
          error={error}
          onRetry={refresh}
          isEmpty={integrations.length === 0}
          emptyMessage="Nenhuma integração SGP por canal ainda."
        >
          <div className="settings-sgp-deliveries space-y-3">
            {integrations.map((integration) => (
              <SgpIntegrationCard
                key={integration.id}
                integration={integration}
                channels={channels}
                templates={approvedTemplates}
                onChanged={refresh}
                onKeyGenerated={setChaveGerada}
              />
            ))}
          </div>
        </AsyncState>
        <SegredoGeradoDialog
          open={Boolean(chaveGerada)}
          titulo="Nova chave gerada"
          explicacao={chaveGerada ? `Esta é a chave da integração “${chaveGerada.integration.description}” (${chaveGerada.referenciaDoCanal}). Ela aparece uma única vez: copie e cadastre no SGP antes de fechar.` : ''}
          rotulo="Chave de API"
          segredo={chaveGerada ? chaveGerada.apiKey : ''}
          rotuloCopiar="Copiar chave"
          confirmacaoCopia="Chave copiada."
          rotuloFechar="Já guardei a chave"
          onClose={() => setChaveGerada(null)}
        />
      </div>
    </ProtectedRoute>
  );
}

export default SgpChannelPage;
