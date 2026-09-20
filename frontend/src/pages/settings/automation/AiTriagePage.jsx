import { SettingsSteps } from '../SettingsVisuals';
import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Field, Button, Toggle, AsyncState, inputClass } from '../../../components/ui';
import { useAiTriageForm } from './useAiTriageForm';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useReasons } from '../../../hooks/useReasons';
import { useChannels } from '../../../hooks/useChannels';
import { computeStatus } from '../../../components/OpenAiConfigCard';
import { useAuth } from '../../../contexts/AuthContext';
import { setAssistantSuggestionsEnabled } from '../../../services/api';

const STATUS_BADGE_CLASS = {
  Desativada: 'bg-wa-surface-soft text-wa-muted',
  'Não configurada': 'bg-wa-surface-soft text-wa-muted',
  Erro: 'border border-wa-error-text/30 bg-wa-error-bg text-wa-error-text',
  Conectada: 'bg-wa-chip text-wa-chip-text',
};

function AiTriagePage() {
  const form = useAiTriageForm();
  const { token } = useAuth();
  const { config, refresh: refreshAiConfig } = useAiConfig();
  const { reasons, status: reasonsStatus } = useReasons();
  const { channels, status: channelsStatus } = useChannels(true);

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
      wide
    >
      <SettingsSteps items={[['usuarios','Durante o atendimento humano'],['ia','Triagem com IA'],['motivos','Conclusão e encaminhamento']]} />
      <div className="settings-ai-policy @container">
        <div className="grid gap-3 border-b border-wa-border pb-3 @min-[760px]:grid-cols-2 @min-[760px]:gap-5">
          {/* Chave própria, e não um quarto "modo": desligar a IA pelo modo levaria
              junto a triagem e a transcrição de áudio, que continuam desejadas. */}
          <section aria-labelledby="ai-human-heading" className="min-w-0">
            <h2 id="ai-human-heading" className="border-l-[3px] border-chat-orange pl-2.5 text-[16px] font-semibold leading-5 text-wa-text">Durante o atendimento humano</h2>
            <div className="mt-2.5">
              <Toggle
                id="assistant-suggestions"
                checked={Boolean(config.assistantSuggestionsEnabled)}
                onChange={async (e) => {
                  await setAssistantSuggestionsEnabled(e.target.checked, token);
                  refreshAiConfig();
                }}
                label="Sugerir respostas ao atendente"
                description="Desmarcado, a IA não escreve sugestões depois que um atendente assume a conversa. A triagem antes do atendimento e a transcrição de áudio continuam funcionando normalmente."
              />
            </div>
          </section>

          <section aria-labelledby="ai-status-heading" className="min-w-0 @min-[760px]:border-l @min-[760px]:border-wa-border @min-[760px]:pl-5">
            <h2 id="ai-status-heading" className="border-l-[3px] border-chat-orange pl-2.5 text-[16px] font-semibold leading-5 text-wa-text">Situação</h2>
            <div className="mt-2 flex items-center justify-between gap-3 text-[13.5px]">
              <Link to="/configuracoes/integracoes/openai" className="text-wa-link hover:underline">OpenAI</Link>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[openAiStatus] || ''}`}>{openAiStatus}</span>
            </div>
            <div className="mt-2 border-t border-wa-border pt-2">
              <p className="mb-1.5 text-[12.5px] font-medium text-wa-muted">Canais com IA ligada</p>
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
                <ul className="flex flex-wrap gap-1.5 text-[12.5px]">
                  {aiChannels.map((c) => (
                    <li key={c.id} className="rounded-md bg-white/[0.06] px-2 py-1">{c.name}</li>
                  ))}
                </ul>
              </AsyncState>
            </div>
          </section>
        </div>
        <AsyncState status={form.status} skeletonLines={5}>
          <form className="pt-3" onSubmit={(e) => { e.preventDefault(); form.save(); }}>
            <section aria-labelledby="ai-triage-heading" className="min-w-0">
              <h2 id="ai-triage-heading" className="border-l-[3px] border-chat-orange pl-2.5 text-[16px] font-semibold leading-5 text-wa-text">Triagem com IA</h2>
              <p className="mt-1.5 text-[13px] leading-[18px] text-wa-muted">
                Controla quando a IA se sente segura para responder sozinha e quantas perguntas ela pode
                fazer antes de encaminhar para um atendente.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 @min-[600px]:grid-cols-3">
                <Field
                  id="triage-confidence"
                  label="Confiança mínima (%)"
                  width="xs"
                  help="Abaixo deste valor, o resumo entregue ao atendente é marcado como confiança baixa. Não gera pergunta ao cliente."
                >
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
                <Field id="triage-max-questions" label="Máximo de perguntas" width="xs">
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
                <Field id="triage-timeout" label="Tempo limite (minutos)" width="xs">
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
              <div className="mt-3 grid grid-cols-1 items-start gap-3 @min-[760px]:grid-cols-2">
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
                    className={`${inputClass} min-h-[94px] resize-y`}
                  />
                </Field>
              </div>
              {form.error && (
                <p role="alert" className="mt-3 rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">
                  {form.error}
                </p>
              )}
              <div className="mt-3 flex justify-end border-t border-wa-border pt-3">
                <Button type="submit" loading={form.saving}>Salvar triagem com IA</Button>
              </div>
            </section>
          </form>
        </AsyncState>
      </div>
    </SettingsPage>
  );
}

export default AiTriagePage;
