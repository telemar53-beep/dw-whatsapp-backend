import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card, Field, Button, AsyncState, inputClass } from '../../../components/ui';
import { useAiTriageForm } from './useAiTriageForm';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useReasons } from '../../../hooks/useReasons';
import { useChannels } from '../../../hooks/useChannels';
import { computeStatus } from '../../../components/OpenAiConfigCard';

const STATUS_BADGE_CLASS = {
  Desativada: 'bg-wa-surface-soft text-wa-muted',
  'Não configurada': 'bg-wa-surface-soft text-wa-muted',
  Erro: 'border border-wa-error-text/30 bg-wa-error-bg text-wa-error-text',
  Conectada: 'bg-wa-green/15 text-wa-green',
};

function AiTriagePage() {
  const form = useAiTriageForm();
  const { config } = useAiConfig();
  const { reasons, loading: reasonsLoading, status: reasonsHookStatus } = useReasons();
  const reasonsStatus = reasonsHookStatus || (reasonsLoading ? 'loading' : 'ready');
  const { channels, loading: channelsLoading, status: channelsHookStatus } = useChannels(true);
  const channelsStatus = channelsHookStatus || (channelsLoading ? 'loading' : 'ready');

  const openAiStatus = computeStatus({ mode: config.mode, configured: config.configured, hasError: false });
  const aiChannels = channels.filter((c) => c.aiEnabled);
  const reasonMissing =
    Boolean(form.values.resolvedReasonId) &&
    !reasons.some((r) => r.id === form.values.resolvedReasonId) &&
    reasonsStatus === 'ready';

  return (
    <SettingsPage
      title="Atendimento e triagem com IA"
      description="Quando a IA responde sozinha e quantas perguntas pode fazer."
      scope="global"
    >
      <Card title="Situação">
        <div className="flex items-center justify-between gap-3">
          <Link to="/configuracoes/integracoes/openai" className="text-wa-link hover:underline">OpenAI</Link>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[openAiStatus] || ''}`}>{openAiStatus}</span>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-wa-muted">Canais com IA ligada</p>
          <AsyncState
            status={channelsStatus}
            isEmpty={aiChannels.length === 0}
            emptyMessage={
              <>
                Nenhum canal com IA ligada. Ligue em{' '}
                <Link to="/configuracoes/canais" className="text-wa-link hover:underline">Canais</Link>.
              </>
            }
          >
            <ul className="space-y-1 text-[14px]">
              {aiChannels.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          </AsyncState>
        </div>
      </Card>
      <AsyncState status={form.status} skeletonLines={5}>
        <form onSubmit={(e) => { e.preventDefault(); form.save(); }}>
          <Card title="Triagem com IA" footer={<Button type="submit" loading={form.saving}>Salvar triagem com IA</Button>}>
            <p className="text-sm text-wa-muted">
              Controla quando a IA se sente segura para responder sozinha e quantas perguntas ela pode
              fazer antes de encaminhar para um atendente.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field id="triage-confidence" label="Confiança mínima (%)">
                <input
                  id="triage-confidence"
                  type="number"
                  min="0"
                  max="100"
                  value={form.values.confidencePercent}
                  onChange={(e) => form.setValue('confidencePercent', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field id="triage-max-questions" label="Máximo de perguntas">
                <input
                  id="triage-max-questions"
                  type="number"
                  min="0"
                  max="5"
                  value={form.values.maxQuestions}
                  onChange={(e) => form.setValue('maxQuestions', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field id="triage-timeout" label="Tempo limite (minutos)">
                <input
                  id="triage-timeout"
                  type="number"
                  min="1"
                  max="60"
                  value={form.values.timeoutMinutes}
                  onChange={(e) => form.setValue('timeoutMinutes', e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field
              id="triage-resolved-reason"
              label="Encerrar sozinha depois de entregar boleto/PIX"
              help="Com um motivo escolhido, a IA pergunta se o cliente precisa de mais algo e, se não, encerra o atendimento com esse motivo. Sem motivo, a conversa vai para a fila como hoje."
              error={reasonMissing ? 'O motivo escolhido está inativo ou não existe mais' : undefined}
            >
              <select
                id="triage-resolved-reason"
                value={form.values.resolvedReasonId}
                onChange={(e) => form.setValue('resolvedReasonId', e.target.value)}
                className={inputClass}
              >
                <option value="">Não encerrar: encaminhar ao setor (padrão)</option>
                {reasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>{reason.name}</option>
                ))}
              </select>
            </Field>
            <Field id="triage-extra-instructions" label="Instruções adicionais">
              <textarea
                id="triage-extra-instructions"
                rows={3}
                value={form.values.extraInstructions}
                onChange={(e) => form.setValue('extraInstructions', e.target.value)}
                className={inputClass}
              />
            </Field>
            {form.error && (
              <p role="alert" className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">
                {form.error}
              </p>
            )}
          </Card>
        </form>
      </AsyncState>
    </SettingsPage>
  );
}

export default AiTriagePage;
