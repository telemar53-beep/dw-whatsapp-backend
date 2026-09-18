import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card, Toggle, Button, AsyncState, HelpText } from '../../../components/ui';
import { useAiTriageForm } from './useAiTriageForm';

function IdentificationPage() {
  const form = useAiTriageForm();

  return (
    <SettingsPage
      title="Identificação e comprovantes"
      description="Como a IA confirma quem é o cliente e lê comprovantes."
      scope="global"
    >
      <AsyncState status={form.status} skeletonLines={4}>
        <form onSubmit={(e) => { e.preventDefault(); form.save(); }}>
          <Card title="Identificação" footer={<Button type="submit" loading={form.saving}>Salvar identificação</Button>}>
            <Toggle
              id="triage-read-receipts-daytime"
              checked={form.values.readReceiptsDaytime}
              onChange={(e) => form.setValue('readReceiptsDaytime', e.target.checked)}
              label="Ler comprovantes também de dia (sem desbloqueio)"
              description="A triagem lê a imagem, confere valor, data e favorecido e avisa a atendente se o comprovante já foi usado. Nenhuma liberação de dia. Cada leitura é uma chamada de visão à OpenAI."
            />
            <HelpText>
              A identificação por CPF é sempre feita quando a triagem com IA roda. Os nomes aceitos no
              comprovante ficam em{' '}
              <Link to="/configuracoes/empresa" className="text-wa-link hover:underline">Empresa</Link>.
            </HelpText>
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

export default IdentificationPage;
