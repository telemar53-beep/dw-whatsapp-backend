import SettingsPage from '../SettingsPage';
import { Card, Toggle, AsyncState } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useAiTools } from '../../../hooks/useAiTools';
import { setAiToolEnabled } from '../../../services/api';
import { toolLabel } from './aiToolLabels';

// Agrupamento apenas de apresentação. A categoria e as permissões recebidas da API
// continuam intactas; ferramentas futuras aparecem em "Outras ações".
const DISPLAY_GROUPS = [
  {
    id: 'consultas', label: 'Consultas', names: [
      'buscar_cliente', 'consultar_status_contrato', 'consultar_status_conexao',
      'consultar_plano', 'consultar_status_todos_contratos',
    ],
  },
  {
    id: 'financeiro', label: 'Financeiro', names: [
      'consultar_financeiro', 'consultar_faturas', 'consultar_faturas_todos_contratos',
      'analisar_comprovante', 'gerar_segunda_via', 'gerar_pix',
      'desbloqueio_confianca', 'enviar_boleto',
    ],
  },
  {
    id: 'atendimento', label: 'Atendimento', names: [
      'definir_motivo_atendimento', 'esquecer_identificacao', 'concluir_triagem',
    ],
  },
  {
    id: 'transferencia', label: 'Transferência e encerramento', names: [
      'transferir_atendimento', 'encerrar_atendimento',
    ],
  },
];
const DISPLAY_NAMES = new Set(DISPLAY_GROUPS.flatMap((group) => group.names));

function AiToolsPage() {
  const { token } = useAuth();
  const { config } = useAiConfig();
  const { tools, status, refresh } = useAiTools();

  async function handleToggle(nome, enabled) {
    await setAiToolEnabled(nome, enabled, token);
    refresh();
  }

  const groups = DISPLAY_GROUPS.map((group) => ({
    ...group,
    items: tools.filter((tool) => group.names.includes(tool.nome)),
  })).filter((group) => group.items.length > 0);
  const otherTools = tools.filter((tool) => !DISPLAY_NAMES.has(tool.nome));
  if (otherTools.length > 0) groups.push({ id: 'outras', label: 'Outras ações', items: otherTools });
  const columns = [
    groups.filter((_, index) => index % 2 === 0),
    groups.filter((_, index) => index % 2 === 1),
  ].filter((column) => column.length > 0);
  const enabledCount = tools.filter((tool) => tool.enabled).length;

  const encerrarTool = tools.find((t) => t.nome === 'encerrar_atendimento');
  const showEncerrarWarning = Boolean(config.triageResolvedReasonId) && encerrarTool && !encerrarTool.enabled;

  return (
    <SettingsPage
      title="Ações permitidas à IA"
      description="O que a IA pode consultar e fazer no SGP."
      scope="global"
      wide
    >
      {showEncerrarWarning && (
        <Card tone="warn">
          <p className="text-[13.5px] text-wa-warn-text">
            Encerrar sozinha está configurado, mas a ferramenta Encerrar atendimento sozinha está desligada.
          </p>
        </Card>
      )}
      <AsyncState status={status} isEmpty={groups.length === 0} emptyMessage="Nenhuma ferramenta cadastrada.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-wa-muted" aria-label="Resumo das ações">
            <span><strong className="font-semibold text-wa-text">{tools.length}</strong> ações</span>
            <span><strong className="font-semibold text-wa-text">{enabledCount}</strong> ativas</span>
            <span><strong className="font-semibold text-wa-text">{tools.length - enabledCount}</strong> desativadas</span>
          </div>
          <div className="@container">
            <div className="grid grid-cols-1 items-start gap-3 @min-[760px]:grid-cols-2">
              {columns.map((column, index) => (
                <div key={index} className="min-w-0 space-y-3">
                  {column.map((group) => (
                    <section key={group.id} aria-labelledby={`ai-tools-${group.id}`} className="min-w-0 overflow-hidden rounded-[13px] border border-white/[0.08] bg-[#30393e]">
                      <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2.5">
                        <h2 id={`ai-tools-${group.id}`} className="text-[14px] font-semibold leading-5 text-wa-text">{group.label}</h2>
                        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] tabular-nums text-wa-muted">{group.items.length}</span>
                      </div>
                      <div className="divide-y divide-white/[0.07] px-2">
                        {group.items.map((tool) => (
                          <div key={tool.nome} className="relative min-h-[39px] py-2 pl-1 pr-[88px]">
                            <Toggle
                              id={`tool-${tool.nome}`}
                              checked={tool.enabled}
                              onChange={(e) => handleToggle(tool.nome, e.target.checked)}
                              label={
                                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                  <span>{toolLabel(tool.nome)}</span>
                                  {tool.categoria === 'ACAO_SENSIVEL' && <span className="rounded bg-[#a46e45]/[0.18] px-1.5 py-0.5 text-[10px] leading-3 text-[#e9b18b]">Ação sensível</span>}
                                </span>
                              }
                            />
                            <details className="text-[12px] leading-[17px] text-wa-muted">
                              <summary className="absolute right-1 top-[9px] cursor-pointer list-none text-[11.5px] font-medium text-chat-copper hover:text-chat-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chat-orange [&::-webkit-details-marker]:hidden">Quando usar</summary>
                              <div className="mt-2 border-l-2 border-chat-copper/50 pl-2.5">
                                <p>{tool.descricao}</p>
                                <p className="mt-1 text-[11px] text-wa-muted">Identificador técnico: <code>{tool.nome}</code></p>
                              </div>
                            </details>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </AsyncState>
    </SettingsPage>
  );
}

export default AiToolsPage;
