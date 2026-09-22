import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Toggle, Button, AsyncState, Card } from '../../../components/ui';
import { useCompanyConfig } from '../../../hooks/useCompanyConfig';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useAiTriageForm, CAMPOS_DA_IDENTIFICACAO } from './useAiTriageForm';

// Selo de dependência: diz o estado de uma configuração de OUTRA página, sem
// trazer o controle dela para cá. Quem decide continua sendo a página dona.
function Dependencia({ pronta, ativo, inativo }) {
  return (
    <span className={`settings-dependency-chip ${pronta ? 'is-pronta' : ''}`}>
      <span aria-hidden="true" className="settings-dependency-dot" />
      {pronta ? ativo : inativo}
    </span>
  );
}

function IdentificationPage() {
  // Esta tela é dona de UM campo só. Os demais da mesma linha de configuração
  // pertencem à Triagem com IA e ao Atendimento noturno, e não são enviados
  // daqui — o PATCH não encosta em coluna que não veio. Ver useAiTriageForm.
  const form = useAiTriageForm(CAMPOS_DA_IDENTIFICACAO);
  const { config: ia } = useAiConfig();
  const { config: empresa, status: statusEmpresa } = useCompanyConfig();

  const triagemLigada = ia.mode === 'triage' || ia.mode === 'full';
  const favorecidos = (empresa.acceptedPayeeNames || []).length;

  return (
    <SettingsPage
      wide
      title="Identificação e comprovantes"
      description="Como a IA confirma quem é o cliente e lê comprovantes."
      scope="global"
    >
      <AsyncState status={form.status} skeletonLines={4}>
        <form onSubmit={(e) => { e.preventDefault(); form.save(); }} className="settings-identification">
          {/* 1. Dependência: quem liga a identificação por CPF é a Triagem. */}
          <Card
            title="Identificação do cliente"
            scope="depends"
            scopeDetail="Triagem com IA"
            footer={
              <>
                <Dependencia pronta={triagemLigada} ativo="Triagem com IA ativa" inativo="Triagem com IA desligada" />
                <Link to="/configuracoes/automacao/ia" className="settings-dependency-link">
                  Configurar triagem com IA →
                </Link>
              </>
            }
          >
            <p className="settings-dependency-text">
              A identificação por CPF acontece durante a triagem com IA. Não há nada para configurar aqui: ligar ou
              desligar é decisão da página da triagem.
            </p>
          </Card>

          {/* 2. A única configuração desta página. */}
          <Card title="Leitura de comprovantes" description="Quando a triagem pode analisar um comprovante recebido.">
            <Toggle
              id="triage-read-receipts-daytime"
              checked={form.values.readReceiptsDaytime}
              onChange={(e) => form.setValue('readReceiptsDaytime', e.target.checked)}
              label="Ler comprovantes também de dia (sem desbloqueio)"
              description="A triagem lê a imagem, confere valor, data e favorecido e avisa a atendente se o comprovante já foi usado. Nenhuma liberação de dia. Cada leitura é uma chamada de visão à OpenAI."
            />
          </Card>

          {/* 3. Dependência: a lista de favorecidos é da Empresa. */}
          <Card
            title="Favorecidos aceitos"
            scope="depends"
            scopeDetail="Empresa"
            footer={
              <>
                <Dependencia
                  pronta={favorecidos > 0}
                  ativo={`${favorecidos} ${favorecidos === 1 ? 'nome cadastrado' : 'nomes cadastrados'}`}
                  inativo="Nenhum nome cadastrado"
                />
                <Link to="/configuracoes/empresa" className="settings-dependency-link">
                  Configurar Empresa →
                </Link>
              </>
            }
          >
            <p className="settings-dependency-text">
              A IA compara o favorecido do comprovante com os nomes aceitos da empresa.{' '}
              {statusEmpresa === 'ready' && favorecidos === 0
                ? 'Sem nenhum nome cadastrado, nenhum comprovante confere.'
                : 'A lista fica no cadastro da empresa.'}
            </p>
          </Card>

          {form.error && (
            <p role="alert" className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">
              {form.error}
            </p>
          )}

          <div className="settings-actions">
            <Button type="submit" loading={form.saving}>Salvar identificação</Button>
          </div>
        </form>
      </AsyncState>
    </SettingsPage>
  );
}

export default IdentificationPage;
