import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Toggle, Button, AsyncState } from '../../../components/ui';
import { useAiTriageForm } from './useAiTriageForm';

function IdentificationPage() {
  const form = useAiTriageForm();

  return (
    <SettingsPage
      wide
      title="Identificação e comprovantes"
      description="Como a IA confirma quem é o cliente e lê comprovantes."
      scope="global"
    >
      <AsyncState status={form.status} skeletonLines={4}>
        <form onSubmit={(e) => { e.preventDefault(); form.save(); }} className="settings-identification settings-open-form grid items-start gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section aria-labelledby="identification-cpf-title" className="settings-pane">
            <h2 id="identification-cpf-title" className="font-display text-[16px] font-semibold text-wa-text">Identificação por CPF</h2>
            <p className="mt-1 text-[13.5px] leading-5 text-wa-muted">A identificação por CPF é feita quando a triagem com IA está em funcionamento.</p>
          </section>
          <section aria-labelledby="identification-receipts-title" className="settings-pane">
            <h2 id="identification-receipts-title" className="font-display text-[16px] font-semibold text-wa-text">Leitura de comprovantes</h2>
            <p className="mb-3 mt-1 text-[13px] text-wa-muted">Defina quando a triagem pode analisar comprovantes recebidos.</p>
            <Toggle
              id="triage-read-receipts-daytime"
              checked={form.values.readReceiptsDaytime}
              onChange={(e) => form.setValue('readReceiptsDaytime', e.target.checked)}
              label="Ler comprovantes também de dia (sem desbloqueio)"
              description="A triagem lê a imagem, confere valor, data e favorecido e avisa a atendente se o comprovante já foi usado. Nenhuma liberação de dia. Cada leitura é uma chamada de visão à OpenAI."
            />
            <p className="mt-3 border-t border-white/[0.08] pt-3 text-[12.5px] leading-5 text-wa-muted">
              Os nomes aceitos no comprovante ficam em{' '}
              <Link to="/configuracoes/empresa" className="text-wa-link hover:underline">Empresa</Link>.
            </p>
            {form.error && (
              <p role="alert" className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">
                {form.error}
              </p>
            )}
          </section>
          <div className="settings-actions lg:col-span-2"><Button type="submit" loading={form.saving}>Salvar identificação</Button></div>
        </form>
      </AsyncState>
    </SettingsPage>
  );
}

export default IdentificationPage;
