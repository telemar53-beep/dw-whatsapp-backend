import { Link, Outlet, useMatch } from 'react-router-dom';
import ProtectedRoute from '../../../components/ProtectedRoute';
import { PageHeader } from '../../../components/ui';
import { IconServer, IconBrain, IconLock, IconInfo } from '../../../components/icons/WaIcons';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { computeStatus } from '../../../components/OpenAiConfigCard';

const BASE = '/configuracoes/integracoes';

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

// Um cartão por serviço. O escolhido ganha a borda laranja; o cartão inteiro é
// o link, e o rodapé diz o que acontece ao clicar.
function ServiceCard({ to, active, icon, title, badge, description, footerLeft, footerRight }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col rounded-[16px] border bg-wa-surface p-4 backdrop-blur-xl transition sm:p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
        active ? 'border-chat-orange shadow-[0_0_0_1px_var(--color-chat-orange)]' : 'border-wa-surface-line hover:border-wa-border-strong'
      }`}
    >
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border border-wa-border bg-white/[0.05] text-wa-text">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[17px] font-semibold leading-[22px] text-wa-text">{title}</span>
            {badge}
          </div>
          <p className="mt-1 max-w-[42ch] text-[13.5px] leading-[19px] text-wa-muted">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-wa-border pt-3 text-[12.5px] text-wa-muted">
        {footerLeft}
        {footerRight}
      </div>
    </Link>
  );
}

function IntegrationsLayout() {
  const sgpActive = Boolean(useMatch(`${BASE}/sgp/*`));
  const openAiActive = Boolean(useMatch(`${BASE}/openai`));
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
        <div className="px-4">
          <PageHeader
            crumbs={[{ label: 'Configurações', to: '/configuracoes' }]}
            title="Integrações"
            description="Conecte o atendimento aos serviços da sua operação."
          />
        </div>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2 sm:px-6">
          <div className="max-w-6xl space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <ServiceCard
                to={`${BASE}/sgp/consultas`}
                active={sgpActive}
                icon={<IconServer size={26} />}
                title="SGP"
                badge={sgpBadge}
                description="Consultas de clientes, contratos e faturas. Envios vinculados aos canais."
                footerLeft={<span>{perChannel === 1 ? '1 integração por canal' : `${perChannel} integrações por canal`}</span>}
                footerRight={<span className="font-medium text-chat-orange">Ver configuração →</span>}
              />
              <ServiceCard
                to={`${BASE}/openai`}
                active={openAiActive}
                icon={<IconBrain size={26} />}
                title="OpenAI"
                badge={aiBadge}
                description="Atendimento com IA, leitura de comprovantes e transcrição de áudio."
                footerLeft={
                  <span className="inline-flex items-center gap-1.5">
                    <IconLock size={13} />
                    Credencial protegida
                  </span>
                }
                footerRight={
                  <span className="inline-flex h-9 items-center rounded-[10px] border border-wa-border bg-wa-field px-3.5 text-[13.5px] font-medium text-wa-text">
                    Configurar
                  </span>
                }
              />
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
