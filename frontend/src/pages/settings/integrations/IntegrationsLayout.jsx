import { SettingsTitle, SettingsIcon } from '../SettingsVisuals';
import { Link, Outlet, useLocation } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { PageHeader } from '../../../components/ui';
import { IconInfo } from '../../../components/icons/WaIcons';
import { findSettingsItem } from '../../../navigation/navItems';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { computeStatus } from '../../../components/OpenAiConfigCard';

// Selo de situação: verde quando a integração está de pé, cinza nos outros casos.
function StatusBadge({ label, tone }) {
  const cls =
    tone === 'ok'
      ? 'border-wa-chip-text/30 bg-wa-chip text-wa-chip-text'
      : tone === 'error'
        ? 'border-wa-error-text/30 bg-wa-error-bg text-wa-error-text'
        : 'border-wa-border bg-white/[0.06] text-wa-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[12px] font-medium ${cls}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function IntegrationsLayout() {
  const location = useLocation();
  const selected = findSettingsItem(location.pathname)?.item;
  const { config: sgp, status: sgpStatus } = useSgpQueryConfig();
  const { integrations } = useSgpIntegrations();
  const { config: ai, status: aiStatus } = useAiConfig();

  const sgpBadge =
    sgpStatus !== 'ready' ? null : !sgp.configured ? (
      <StatusBadge label="Não configurado" />
    ) : sgp.enabled ? (
      <StatusBadge label="Ativo" tone="ok" />
    ) : (
      <StatusBadge label="Inativo" />
    );
  const aiLabel = computeStatus({ mode: ai.mode, configured: ai.configured, hasError: false });
  const aiBadge = aiStatus !== 'ready' ? null : <StatusBadge label={aiLabel} tone={aiLabel === 'Conectada' ? 'ok' : undefined} />;
  const perChannel = integrations.length;

  return (
    <ProtectedRoute level="integrations" areaLabel="Integrações">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="settings-group-header border-b border-white/[0.07] px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: '/configuracoes' }, { label: 'Integrações' }]}
            title={<SettingsTitle name={selected?.key}>{selected?.label || 'Integrações'}</SettingsTitle>}
            description={selected?.description || 'Conecte o atendimento aos serviços da sua operação.'}
          />
        </div>
        <div className="settings-group-body chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-4 sm:px-6">
          <div className="max-w-6xl space-y-3">
            <div className="settings-service-switchboard" aria-label="Estado das integrações">
              <Link to="/configuracoes/integracoes/sgp/consultas" aria-current={selected?.key === 'sgp-consultas' ? 'page' : undefined}><SettingsIcon name="sgp-consultas"/><span>SGP<small>Consultas</small></span>{sgpBadge}</Link>
              <Link to="/configuracoes/integracoes/openai" aria-current={selected?.key === 'openai' ? 'page' : undefined}><SettingsIcon name="openai"/><span>OpenAI<small>Modelos e credenciais</small></span>{aiBadge}</Link>
              <Link to="/configuracoes/integracoes/sgp/envios" aria-current={selected?.key === 'sgp-envios' ? 'page' : undefined}><SettingsIcon name="sgp-envios"/><span>SGP · Pix e boleto<small>{perChannel === 1 ? '1 integração por canal' : `${perChannel} integrações por canal`}</small></span></Link>
            </div>

            <Outlet />

            <p className="flex flex-wrap items-center gap-2 rounded-[12px] border border-wa-border bg-white/[0.03] px-4 py-3 text-[13px] text-wa-muted">
              <IconInfo size={16} />
              As configurações de WhatsApp ficam em Canais WhatsApp.
              <Link to="/configuracoes/canais" className="font-medium text-chat-orange hover:underline">
                Gerenciar canais →
              </Link>
            </p>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default IntegrationsLayout;
