import { Card, DataTable } from '../../../components/ui';
import { NAV_ITEMS, SETTINGS_SECTIONS, hasLevel } from '../../../navigation/navItems';

const PROFILES = [
  { label: 'Atendente', agent: { role: 'agent' } },
  { label: 'Gerente', agent: { role: 'manager', canManageIntegrations: false } },
  { label: 'Gerente com credenciais', agent: { role: 'manager', canManageIntegrations: true } },
  { label: 'Administrador', agent: { role: 'admin' } },
];

// Ações que não são página inteira, mas dependem de credenciais (mesma
// regra de requireIntegrationsAccess no backend).
const EXTRA_ROWS = [
  { label: 'Canais: criar, WABA ID, reconectar, ocultar, excluir e interruptores', level: 'integrations' },
  { label: 'Boas-vindas por canal: salvar e excluir', level: 'integrations' },
];

const FIXED_RULES = [
  'Gerente só cria e edita contas de atendente; nunca de outro gerente ou administrador.',
  'Ninguém desativa a própria conta nem gera nova senha para si por esta tela.',
  'Atendente só envia mensagem na conversa atribuída a ele.',
  'Administrador e gerente transferem e encerram qualquer conversa; atendente só a sua.',
  'Atendente vê em Relatórios só os próprios números; administrador e gerente veem a equipe toda.',
  'A permissão de credenciais de um gerente só passa a valer no próximo login dele.',
];

function RolesPage() {
  const sections = [
    { title: 'Navegação principal', rows: NAV_ITEMS.filter((i) => i.key !== 'configuracoes').map((i) => ({ label: i.label, level: i.level })) },
    ...SETTINGS_SECTIONS.map((group) => ({ title: group.group, rows: group.items })),
    { title: 'Ações com credenciais', rows: EXTRA_ROWS },
  ];
  return (
    <div className="settings-permissions">
      <Card title="Páginas e ações" description="O que cada perfil pode ver e fazer. Esta tabela é gerada da mesma lista que controla o menu e as rotas.">
        <DataTable className="min-w-[560px]" label="Permissões por perfil">
            <thead>
              <tr className="text-left text-wa-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Área</th>
                {PROFILES.map((p) => <th key={p.label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{p.label}</th>)}
              </tr>
            </thead>
            {sections.map((section) => <tbody key={section.title}>
                <tr className="border-t border-wa-border bg-white/[0.04]">
                  <th scope="rowgroup" colSpan={PROFILES.length + 1} className="px-2 py-2 text-left text-[12px] font-semibold uppercase tracking-[.08em] text-chat-copper">{section.title}</th>
                </tr>
                {section.rows.map((row) => (
                <tr key={row.label} className="border-t border-wa-border">
                  <th scope="row" className="py-2 pl-2 pr-3 text-left font-normal text-wa-text">{row.label}</th>
                  {PROFILES.map((p) => {
                    const ok = hasLevel(p.agent, row.level);
                    return <td key={p.label} className={`whitespace-nowrap px-3 py-2 ${ok ? 'text-wa-chip-text' : 'text-wa-muted'}`}>{ok ? 'Sim' : 'Não'}</td>;
                  })}
                </tr>
                ))}
              </tbody>)}
        </DataTable>
      </Card>
      <Card title="Regras que não dependem de página" description="Vêm do backend e valem em qualquer tela.">
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-wa-text">
          {FIXED_RULES.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </Card>
    </div>
  );
}

export default RolesPage;
