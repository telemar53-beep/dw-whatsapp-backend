import { Link, useOutletContext } from 'react-router-dom';
import { Toggle } from '../../../components/ui';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useBusinessHoursConfig } from '../../../hooks/useBusinessHoursConfig';
import { computeStatus } from '../../../components/OpenAiConfigCard';

const PERMISSION_REASON = 'Requer permissão de Canais e Integrações';

function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">{children}</p>;
}

function SummaryRow({ to, label, value }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-wa-border py-2.5 last:border-b-0">
      <Link to={to} className="text-[13.5px] font-medium text-wa-link hover:underline">
        {label}
      </Link>
      <span className="text-[13.5px] text-wa-muted">{value}</span>
    </div>
  );
}

function ChannelBehaviorTab() {
  const { channel, actions, canManage } = useOutletContext();
  const { options } = useTriage();
  const { config: aiConfig } = useAiConfig();
  const { config: businessHours } = useBusinessHoursConfig();

  const nightWindowSet = Boolean(aiConfig.nightStartTime && aiConfig.nightEndTime);
  const openAiStatus = computeStatus({ mode: aiConfig.mode, configured: aiConfig.configured, hasError: false });

  const triageOptionsLabel =
    options.length === 0 ? 'sem opções' : `${options.length} ${options.length === 1 ? 'opção' : 'opções'}`;
  const welcomeLabel = channel.welcomeMessage || 'não definida';
  const businessHoursLabel = businessHours.enabled ? `${businessHours.startTime}–${businessHours.endTime}` : 'não configurado';
  const nightWindowLabel = nightWindowSet ? `${aiConfig.nightStartTime}–${aiConfig.nightEndTime}` : 'não definida';

  const aiTriageDisabledReason = !canManage
    ? PERMISSION_REASON
    : !channel.aiEnabled
      ? 'Precisa de Atendimento com IA ligado'
      : undefined;

  const nightModeDisabledReason = !canManage
    ? PERMISSION_REASON
    : !channel.aiTriageEnabled
      ? 'Precisa de Triagem com IA ligada'
      : !nightWindowSet
        ? (
            <Link to="/configuracoes/automacao/noturno" className="font-medium text-wa-link underline">
              Defina a janela em Automação e IA › Atendimento noturno
            </Link>
          )
        : undefined;

  return (
    <div className="settings-channel-behavior space-y-3">
      {!canManage && (
        <p className="rounded-[12px] bg-wa-warn-bg px-3 py-2.5 text-[13.5px] text-wa-warn-text">{PERMISSION_REASON}</p>
      )}
      <ErrorNote>{actions.errors.triage}</ErrorNote>
      <ErrorNote>{actions.errors.ai}</ErrorNote>
      <ErrorNote>{actions.errors.aiTriage}</ErrorNote>
      <ErrorNote>{actions.errors.aiNightMode}</ErrorNote>

      <section aria-labelledby="channel-automation-title" className="rounded-[14px] border border-wa-border bg-black/[0.08] px-4 py-4 sm:px-5">
        <h3 id="channel-automation-title" className="mb-3 text-[15px] font-semibold text-wa-text">Automações deste canal</h3>
        <div className="grid items-start gap-x-5 gap-y-0 md:grid-cols-2 [&>*]:border-b [&>*]:border-wa-border [&>*]:py-3">
        <Toggle
          id="channel-triage"
          checked={Boolean(channel.triageEnabled)}
          onChange={(e) => actions.toggleTriage(channel.id, e.target.checked)}
          disabled={!canManage}
          disabledReason={!canManage ? PERMISSION_REASON : undefined}
          label="Triagem por menu"
        />
        <Toggle
          id="channel-ai"
          checked={Boolean(channel.aiEnabled)}
          onChange={(e) => actions.toggleAi(channel.id, e.target.checked)}
          disabled={!canManage}
          disabledReason={!canManage ? PERMISSION_REASON : undefined}
          label="Atendimento com IA"
          description="Ligar a IA desliga a triagem por menu neste canal: só um robô responde por vez."
        />
        <Toggle
          id="channel-ai-triage"
          checked={Boolean(channel.aiTriageEnabled)}
          onChange={(e) => actions.toggleAiTriage(channel.id, e.target.checked)}
          disabled={!canManage || !channel.aiEnabled}
          disabledReason={aiTriageDisabledReason}
          label="Triagem com IA"
        />
        <Toggle
          id="channel-ai-night-mode"
          checked={Boolean(channel.aiNightModeEnabled)}
          onChange={(e) => actions.toggleAiNightMode(channel.id, e.target.checked)}
          disabled={!canManage || (!channel.aiNightModeEnabled && (!channel.aiTriageEnabled || !nightWindowSet))}
          disabledReason={nightModeDisabledReason}
          label="Atendimento noturno"
        />
        </div>
      </section>

      <section aria-labelledby="channel-global-title" className="rounded-[14px] border border-wa-border bg-black/[0.08] px-4 py-4 sm:px-5">
        <h3 id="channel-global-title" className="mb-2 text-[15px] font-semibold text-wa-text">Configurações globais que valem para este canal</h3>
        <div className="grid gap-x-6 md:grid-cols-2">
          <SummaryRow to="/configuracoes/automacao/triagem-menu" label="Triagem por menu" value={triageOptionsLabel} />
          <SummaryRow to="/configuracoes/mensagens/boas-vindas" label="Boas-vindas" value={welcomeLabel} />
          <SummaryRow to="/configuracoes/regras/horario" label="Horário de atendimento" value={businessHoursLabel} />
          <SummaryRow to="/configuracoes/automacao/noturno" label="Janela noturna" value={nightWindowLabel} />
          <SummaryRow to="/configuracoes/integracoes/openai" label="OpenAI" value={openAiStatus} />
        </div>
      </section>
    </div>
  );
}

export default ChannelBehaviorTab;
