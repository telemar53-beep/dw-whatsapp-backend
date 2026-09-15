import SettingsPage from '../SettingsPage';
import { Card, Toggle, AsyncState } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useAiTools } from '../../../hooks/useAiTools';
import { setAiToolEnabled } from '../../../services/api';
import { toolLabel } from './aiToolLabels';

const CATEGORY_ORDER = ['CONSULTA', 'ACAO', 'ACAO_SENSIVEL'];
const CATEGORY_LABELS = { CONSULTA: 'Consulta', ACAO: 'Ação', ACAO_SENSIVEL: 'Ação sensível' };

function AiToolsPage() {
  const { token } = useAuth();
  const { config } = useAiConfig();
  const { tools, status, refresh } = useAiTools();

  async function handleToggle(nome, enabled) {
    await setAiToolEnabled(nome, enabled, token);
    refresh();
  }

  const groups = CATEGORY_ORDER.map((categoria) => ({
    categoria,
    items: tools.filter((tool) => tool.categoria === categoria),
  })).filter((group) => group.items.length > 0);

  const encerrarTool = tools.find((t) => t.nome === 'encerrar_atendimento');
  const showEncerrarWarning = Boolean(config.triageResolvedReasonId) && encerrarTool && !encerrarTool.enabled;

  return (
    <SettingsPage
      title="Ferramentas autorizadas"
      description="O que a IA pode consultar e fazer no SGP."
      scope="global"
    >
      {showEncerrarWarning && (
        <Card tone="warn">
          <p className="text-[13.5px] text-wa-warn-text">
            Encerrar sozinha está configurado, mas a ferramenta Encerrar atendimento sozinha está desligada.
          </p>
        </Card>
      )}
      <AsyncState status={status} isEmpty={groups.length === 0} emptyMessage="Nenhuma ferramenta cadastrada.">
        {groups.map((group) => (
          <Card key={group.categoria} title={CATEGORY_LABELS[group.categoria]} tone={group.categoria === 'ACAO_SENSIVEL' ? 'warn' : 'default'}>
            {group.items.map((tool) => (
              <div key={tool.nome}>
                <Toggle
                  id={`tool-${tool.nome}`}
                  checked={tool.enabled}
                  onChange={(e) => handleToggle(tool.nome, e.target.checked)}
                  label={toolLabel(tool.nome)}
                  description={tool.descricao}
                />
                <code className="ml-7 block text-[11.5px] text-wa-muted">{tool.nome}</code>
              </div>
            ))}
          </Card>
        ))}
      </AsyncState>
    </SettingsPage>
  );
}

export default AiToolsPage;
