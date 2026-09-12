import { useAuth } from '../contexts/AuthContext';
import { useAiTools } from '../hooks/useAiTools';
import { setAiToolEnabled } from '../services/api';

const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';

const CATEGORY_ORDER = ['CONSULTA', 'ACAO', 'ACAO_SENSIVEL'];
const CATEGORY_LABELS = { CONSULTA: 'Consulta', ACAO: 'Ação', ACAO_SENSIVEL: 'Ação sensível' };

function AiToolPermissionsCard() {
  const { token } = useAuth();
  const { tools, refresh } = useAiTools();

  async function handleToggle(nome, enabled) {
    await setAiToolEnabled(nome, enabled, token);
    refresh();
  }

  const groups = CATEGORY_ORDER.map((categoria) => ({
    categoria,
    items: tools.filter((tool) => tool.categoria === categoria),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Permissões de ferramentas da IA</h3>
      {groups.map((group) => (
        <div
          key={group.categoria}
          className={
            group.categoria === 'ACAO_SENSIVEL'
              ? 'space-y-2 rounded-xl border border-wa-warn-text/40 bg-wa-warn-bg p-4'
              : 'space-y-2 rounded-xl border border-wa-surface-line bg-wa-surface-soft p-4'
          }
        >
          <p className="text-sm font-semibold text-wa-text">{CATEGORY_LABELS[group.categoria]}</p>
          <div className="space-y-2">
            {group.items.map((tool) => (
              <label key={tool.nome} className="flex items-center gap-2 text-sm text-wa-muted">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  onChange={(e) => handleToggle(tool.nome, e.target.checked)}
                  aria-label={tool.nome}
                  className="h-4 w-4 accent-wa-green"
                />
                <span className="font-medium text-wa-text">{tool.nome}</span>
                <span className="text-wa-muted">— {tool.descricao}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AiToolPermissionsCard;
