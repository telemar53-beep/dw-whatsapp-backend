# Reorganização da interface — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar o frontend em cinco áreas (Atendimento, Supervisão, Campanhas, Relatórios, Configurações) com rotas próprias, menu expandido/compacto, Configurações por assunto, estados de carregamento corretos e as quatro correções da seção 10, preservando todo payload, endpoint e permissão.

**Architecture:** Um `AppShell` com `SideNav` e `<Outlet>` do react-router v6 envolve todas as páginas autenticadas. `Configurações` é um segundo `<Outlet>` dentro de `SettingsLayout`. Uma lista única em `frontend/src/navigation/` declara rota, rótulo, ícone e nível de acesso de cada página; menu, guardas e a página "Perfis" leem dela. Os componentes de aba atuais viram corpo das páginas novas sem mudar lógica de gravação.

**Tech Stack:** React 18, react-router-dom 6, Tailwind v4 (tokens `chat-*`/`wa-*` em `frontend/src/index.css`), Vitest + Testing Library (frontend), Jest + Postgres local (backend), recharts.

**Spec:** `docs/superpowers/specs/2026-09-15-reorganizacao-interface-design.md` (+ anexo `2026-09-15-inventario-funcional.md`).

## Global Constraints

- Nenhum endpoint, payload, identificador ou configuração persistida muda. Única mudança de backend: SQL de leitura em `src/metrics/metrics.repository.js` (Task 11) e `trim()` do `content` em `src/api/campaigns.routes.js:91` (Task 12).
- Nenhuma tela grava ao abrir; nenhuma tela substitui valor carregado por padrão.
- Nada é ligado/desligado automaticamente: dependências viram aviso com link.
- `PUT /api/admin/ai/triage`: as três páginas que dividem o cartão enviam **sempre os nove campos** (`triageConfidenceThreshold, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions, triageResolvedReasonId, nightStartTime, nightEndTime, triageRequireBirthdate, triageReadReceiptsDaytime`).
- `OpenAiConfigCard` continua enviando `{ apiKey?, model, mode }` (sem `systemPrompt`).
- Rotas antigas (`/admin/dashboard`, `/admin/channels`, `/metrics`, `/campaigns`, `/campaigns/:id`) ficam permanentemente como redirecionamentos.
- Textos de confirmação de `window.confirm` são mantidos palavra por palavra no `ConfirmDialog`.
- Nomenclatura: "Setores", "Usuários", "Relatórios", "Supervisão", "Configurações", "Triagem por menu", "Triagem com IA", "Em andamento / Em espera / Em automação / Encerrados", "interruptor" (nunca "toggle"). Rótulos de papel ("Atendente", "Gerente", "Administrador") e dados do cliente não mudam.
- Tema: escuro + laranja + vidro fumê (`chat-*`); componentes de formulário em `wa-*`. Nunca `bg-white`/cor literal solta.
- Todo trabalho num branch `reorganizacao-interface` criado a partir de `main`. Nenhum teste toca produção nem envia mensagem/campanha/cobrança.
- Comandos de teste: frontend `cd frontend && npx vitest run <arquivo>`; backend `npm test -- <arquivo>` na raiz (precisa do Postgres/Redis locais em Docker).
- Commits terminam com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Mapa de arquivos

**Criar**
- `frontend/src/navigation/navItems.js` — `NAV_ITEMS`, `SETTINGS_SECTIONS`, `LEGACY_REDIRECTS`, `hasLevel`, `firstAllowedSettingsPath`.
- `frontend/src/components/ProtectedRoute.jsx` (reescrito) + `frontend/src/pages/AccessDeniedPage.jsx`.
- `frontend/src/components/ui/{Button,Card,Field,Toggle,ScopeBadge,HelpText,Tabs,PageHeader,AsyncState,DangerZone,ConfirmDialog}.jsx` + `frontend/src/components/ui/index.js`.
- `frontend/src/hooks/useConfirm.jsx`, `frontend/src/hooks/useNavCollapsed.js`, `frontend/src/hooks/useAsyncResource.js`.
- `frontend/src/components/AppShell.jsx`, `frontend/src/components/SideNav.jsx` (substitui `NavRail.jsx`).
- `frontend/src/pages/SupervisionPage.jsx` (renomeado de `AttendanceDashboardPage.jsx`), `frontend/src/pages/ReportsPage.jsx` (renomeado de `MetricsPage.jsx`).
- `frontend/src/pages/settings/SettingsLayout.jsx`, `SettingsIndex.jsx`.
- `frontend/src/pages/settings/channels/{ChannelsListPage,ChannelDetailPage,ChannelConnectionTab,ChannelBehaviorTab,useChannelActions}.jsx|js`.
- `frontend/src/pages/settings/automation/{MenuTriagePage,AiTriagePage,IdentificationPage,NightModePage,TranscriptionPage,AiToolsPage}.jsx` + `useAiTriageForm.js` + `aiToolLabels.js`.
- `frontend/src/pages/settings/rules/{AssignmentPage,BusinessHoursPage}.jsx`.
- `frontend/src/pages/settings/messages/{WelcomePage,CityNoticesPage,QuickRepliesPage,TemplatesPage}.jsx`.
- `frontend/src/pages/settings/team/{UsersPage,SectorsPage,RolesPage}.jsx`.
- `frontend/src/pages/settings/integrations/{SgpQueryPage,SgpChannelPage,OpenAiPage}.jsx`.
- `frontend/src/pages/settings/registers/{ReasonsPage,CitiesPage}.jsx`.
- `frontend/src/pages/settings/CompanyPage.jsx`.
- `frontend/src/components/messages/{ChannelWelcomeMessageRow,CityNoticeRow,QuickReplyRow,AssignmentMessageSection,BusinessHoursSection}.jsx` (extraídos de `MessagesAdminTab.jsx`).
- `frontend/src/components/integrations/SgpIntegrationCard.jsx` (extraído de `IntegrationsAdminTab.jsx`).
- `frontend/src/utils/parseRecipients.js`, `frontend/src/utils/formatDuration.js`.
- `frontend/src/pages/settings/channels/channelSummary.js`, `frontend/src/components/messages/StatusDot.jsx`, `frontend/src/test-utils/renderInShell.jsx`.

**Modificar**
- `frontend/src/App.jsx`, `frontend/src/pages/DashboardPage.jsx`, `CampaignsPage.jsx`, `CampaignDetailPage.jsx`, `components/CreateCampaignModal.jsx`, `components/ConversationInfoPanel.jsx`, `components/QueueList.jsx`, `components/MyConversationsList.jsx`, `components/ChannelStatusBanner.jsx`, `components/TriageAdminTab.jsx`, `components/ReasonsAdminTab.jsx`, `components/AgentsAdminTab.jsx`, `components/AiToolPermissionsCard.jsx`, `utils/exportMetricsCsv.js` (só leitura, sem mudança), todos os hooks de listagem (Task 19), `src/metrics/metrics.repository.js`, `src/api/campaigns.routes.js`.

**Remover ao final** (Task 18/15/16): `pages/AdminChannelsPage.jsx`, `pages/AttendanceDashboardPage.jsx`, `pages/MetricsPage.jsx`, `components/NavRail.jsx`, `components/MessagesAdminTab.jsx`, `components/IntegrationsAdminTab.jsx`, `components/AiTriageConfigCard.jsx` e seus testes (substituídos pelos das páginas novas).

---

### Task 0: Branch de trabalho

**Files:** nenhum.

- [ ] **Step 1: Criar o branch a partir de `main`**

```bash
git checkout -b reorganizacao-interface main
```

- [ ] **Step 2: Confirmar que a suíte do frontend passa antes de qualquer mudança**

Run: `cd frontend && npx vitest run`
Expected: todos os arquivos passam (baseline).

---

### Task 1: Registro de navegação e níveis de acesso

**Files:**
- Create: `frontend/src/navigation/navItems.js`
- Test: `frontend/src/navigation/navItems.test.js`

**Interfaces:**
- Produces:
  - `hasLevel(agent, level)` → boolean. `level ∈ 'auth' | 'admin' | 'integrations'`.
  - `NAV_ITEMS`: `[{ key, label, to, match, icon, level }]` (5 itens, ordem do menu).
  - `SETTINGS_SECTIONS`: `[{ group, groupKey, items: [{ key, label, to, level, description }] }]`.
  - `LEGACY_REDIRECTS`: `[{ from, to }]`.
  - `firstAllowedSettingsPath(agent)` → string ou `null`.
  - `SETTINGS_BASE = '/configuracoes'`.

- [ ] **Step 1: Escrever o teste**

```js
// frontend/src/navigation/navItems.test.js
import { describe, test, expect } from 'vitest';
import { hasLevel, NAV_ITEMS, SETTINGS_SECTIONS, LEGACY_REDIRECTS, firstAllowedSettingsPath } from './navItems';

const agent = { role: 'agent' };
const manager = { role: 'manager', canManageIntegrations: false };
const managerFlag = { role: 'manager', canManageIntegrations: true };
const admin = { role: 'admin' };

describe('hasLevel', () => {
  test('auth aceita qualquer perfil com conta', () => {
    expect(hasLevel(agent, 'auth')).toBe(true);
    expect(hasLevel(null, 'auth')).toBe(false);
  });
  test('admin aceita admin e gerente, não atendente', () => {
    expect(hasLevel(agent, 'admin')).toBe(false);
    expect(hasLevel(manager, 'admin')).toBe(true);
    expect(hasLevel(admin, 'admin')).toBe(true);
  });
  test('integrations aceita admin e gerente com a flag', () => {
    expect(hasLevel(manager, 'integrations')).toBe(false);
    expect(hasLevel(managerFlag, 'integrations')).toBe(true);
    expect(hasLevel(admin, 'integrations')).toBe(true);
  });
});

describe('NAV_ITEMS', () => {
  test('tem os cinco itens na ordem do menu', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Atendimento', 'Supervisão', 'Campanhas', 'Relatórios', 'Configurações']);
  });
  test('Supervisão e Configurações exigem nível admin', () => {
    expect(NAV_ITEMS.find((i) => i.key === 'supervisao').level).toBe('admin');
    expect(NAV_ITEMS.find((i) => i.key === 'configuracoes').level).toBe('admin');
  });
});

describe('SETTINGS_SECTIONS', () => {
  test('cada página tem rota sob /configuracoes e um nível válido', () => {
    const items = SETTINGS_SECTIONS.flatMap((g) => g.items);
    expect(items.length).toBe(22);
    items.forEach((item) => {
      expect(item.to.startsWith('/configuracoes/')).toBe(true);
      expect(['admin', 'integrations']).toContain(item.level);
    });
  });
  test('as três páginas de Integrações exigem credenciais', () => {
    const integracoes = SETTINGS_SECTIONS.find((g) => g.groupKey === 'integracoes');
    expect(integracoes.items.every((i) => i.level === 'integrations')).toBe(true);
  });
});

describe('firstAllowedSettingsPath', () => {
  test('admin cai na lista de canais', () => {
    expect(firstAllowedSettingsPath(admin)).toBe('/configuracoes/canais');
  });
  test('gerente sem flag também cai em canais (lista é nível admin)', () => {
    expect(firstAllowedSettingsPath(manager)).toBe('/configuracoes/canais');
  });
  test('atendente não tem página permitida', () => {
    expect(firstAllowedSettingsPath(agent)).toBe(null);
  });
});

describe('LEGACY_REDIRECTS', () => {
  test('cobre as cinco rotas antigas', () => {
    expect(LEGACY_REDIRECTS.map((r) => r.from).sort()).toEqual(
      ['/admin/channels', '/admin/dashboard', '/campaigns', '/campaigns/:id', '/metrics'].sort()
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/navigation/navItems.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```js
// frontend/src/navigation/navItems.js
import {
  IconChats, IconTeam, IconMegaphone, IconChart, IconSettings,
} from '../components/icons/WaIcons';

// Os três níveis espelham src/auth/auth.middleware.js: requireAuth,
// requireRole('admin') (admin+manager) e requireIntegrationsAccess.
export function hasLevel(agent, level) {
  if (!agent) return false;
  if (level === 'auth') return true;
  const adminLevel = agent.role === 'admin' || agent.role === 'manager';
  if (level === 'admin') return adminLevel;
  if (level === 'integrations') {
    return agent.role === 'admin' || (agent.role === 'manager' && agent.canManageIntegrations === true);
  }
  return false;
}

export const SETTINGS_BASE = '/configuracoes';

export const NAV_ITEMS = [
  { key: 'atendimento', label: 'Atendimento', to: '/', match: '/', icon: IconChats, level: 'auth' },
  { key: 'supervisao', label: 'Supervisão', to: '/supervisao', match: '/supervisao/*', icon: IconTeam, level: 'admin' },
  { key: 'campanhas', label: 'Campanhas', to: '/campanhas', match: '/campanhas/*', icon: IconMegaphone, level: 'auth' },
  { key: 'relatorios', label: 'Relatórios', to: '/relatorios', match: '/relatorios/*', icon: IconChart, level: 'auth' },
  { key: 'configuracoes', label: 'Configurações', to: SETTINGS_BASE, match: `${SETTINGS_BASE}/*`, icon: IconSettings, level: 'admin' },
];

const s = (path) => `${SETTINGS_BASE}/${path}`;

export const SETTINGS_SECTIONS = [
  {
    group: 'Canais WhatsApp', groupKey: 'canais',
    items: [
      { key: 'canais', label: 'Canais', to: s('canais'), level: 'admin', description: 'Os números de WhatsApp ligados ao atendimento.' },
    ],
  },
  {
    group: 'Automação e IA', groupKey: 'automacao',
    items: [
      { key: 'triagem-menu', label: 'Triagem por menu', to: s('automacao/triagem-menu'), level: 'admin', description: 'O menu numerado que o cliente recebe antes de falar com um atendente.' },
      { key: 'ia', label: 'Atendimento e triagem com IA', to: s('automacao/ia'), level: 'admin', description: 'Quando a IA responde sozinha e quantas perguntas pode fazer.' },
      { key: 'identificacao', label: 'Identificação e comprovantes', to: s('automacao/identificacao'), level: 'admin', description: 'Como a IA confirma quem é o cliente e lê comprovantes.' },
      { key: 'transcricao', label: 'Transcrição de áudio', to: s('automacao/transcricao'), level: 'admin', description: 'Áudios do cliente viram texto para o atendente e para a IA.' },
      { key: 'noturno', label: 'Atendimento noturno', to: s('automacao/noturno'), level: 'admin', description: 'A janela em que a IA atende sozinha à noite.' },
      { key: 'ferramentas', label: 'Ferramentas autorizadas', to: s('automacao/ferramentas'), level: 'admin', description: 'O que a IA pode consultar e fazer no SGP.' },
    ],
  },
  {
    group: 'Regras de atendimento', groupKey: 'regras',
    items: [
      { key: 'atribuicao', label: 'Atribuição', to: s('regras/atribuicao'), level: 'admin', description: 'Mensagens automáticas ao assumir e ao encerrar um atendimento.' },
      { key: 'horario', label: 'Horário de atendimento', to: s('regras/horario'), level: 'admin', description: 'Quando há atendente humano e o aviso fora do expediente.' },
    ],
  },
  {
    group: 'Mensagens e templates', groupKey: 'mensagens',
    items: [
      { key: 'boas-vindas', label: 'Boas-vindas', to: s('mensagens/boas-vindas'), level: 'admin', description: 'A primeira mensagem que cada canal envia ao cliente.' },
      { key: 'avisos-cidade', label: 'Avisos por cidade', to: s('mensagens/avisos-cidade'), level: 'admin', description: 'Avisos de instabilidade ou manutenção por região.' },
      { key: 'respostas-rapidas', label: 'Respostas rápidas', to: s('mensagens/respostas-rapidas'), level: 'admin', description: 'Textos prontos que o atendente insere com um clique.' },
      { key: 'templates', label: 'Templates WhatsApp', to: s('mensagens/templates'), level: 'admin', description: 'Mensagens aprovadas pela Meta para os canais oficiais.' },
    ],
  },
  {
    group: 'Equipe e acesso', groupKey: 'equipe',
    items: [
      { key: 'usuarios', label: 'Usuários', to: s('equipe/usuarios'), level: 'admin', description: 'Quem entra no sistema: atendentes, gerentes e administradores.' },
      { key: 'setores', label: 'Setores', to: s('equipe/setores'), level: 'admin', description: 'Os times para onde um atendimento pode ir.' },
      { key: 'perfis', label: 'Perfis de acesso', to: s('equipe/perfis'), level: 'admin', description: 'O que cada perfil pode ver e fazer.' },
    ],
  },
  {
    group: 'Integrações', groupKey: 'integracoes',
    items: [
      { key: 'sgp-consulta', label: 'Consulta ao SGP', to: s('integracoes/sgp-consulta'), level: 'integrations', description: 'O chat consulta cliente, contrato e fatura no SGP.' },
      { key: 'sgp-canal', label: 'SGP por canal', to: s('integracoes/sgp-canal'), level: 'integrations', description: 'O SGP dispara mensagens pelo chat com uma chave por canal.' },
      { key: 'openai', label: 'OpenAI', to: s('integracoes/openai'), level: 'integrations', description: 'Credencial, modelo e teste de conexão da IA.' },
    ],
  },
  {
    group: 'Cadastros auxiliares', groupKey: 'cadastros',
    items: [
      { key: 'motivos', label: 'Motivos de atendimento', to: s('cadastros/motivos'), level: 'admin', description: 'O motivo escolhido ao encerrar um atendimento.' },
      { key: 'cidades', label: 'Cidades', to: s('cadastros/cidades'), level: 'admin', description: 'As cidades do cadastro do cliente e dos avisos por região.' },
    ],
  },
  {
    group: 'Empresa', groupKey: 'empresa',
    items: [
      { key: 'empresa', label: 'Empresa', to: s('empresa'), level: 'admin', description: 'Nome da empresa e nomes aceitos na conferência de comprovantes.' },
    ],
  },
];

export const LEGACY_REDIRECTS = [
  { from: '/admin/dashboard', to: '/supervisao' },
  { from: '/admin/channels', to: s('canais') },
  { from: '/metrics', to: '/relatorios' },
  { from: '/campaigns', to: '/campanhas' },
  { from: '/campaigns/:id', to: '/campanhas/:id' },
];

export function firstAllowedSettingsPath(agent) {
  for (const group of SETTINGS_SECTIONS) {
    for (const item of group.items) {
      if (hasLevel(agent, item.level)) return item.to;
    }
  }
  return null;
}

export function findSettingsItem(pathname) {
  for (const group of SETTINGS_SECTIONS) {
    for (const item of group.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return { group, item };
    }
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/navigation/navItems.test.js`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/navigation
git commit -m "Add the navigation registry with access levels and legacy redirects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: ProtectedRoute com níveis e página de acesso negado

**Files:**
- Modify: `frontend/src/components/ProtectedRoute.jsx`
- Create: `frontend/src/pages/AccessDeniedPage.jsx`
- Test: `frontend/src/components/ProtectedRoute.test.jsx` (reescrever)

**Interfaces:**
- Consumes: `hasLevel` (Task 1).
- Produces: `<ProtectedRoute level="auth|admin|integrations" areaLabel="Supervisão">children</ProtectedRoute>`. Mantém a prop antiga `requireAdmin` como alias de `level="admin"` até a Task 7 remover os usos.
- `AccessDeniedPage({ areaLabel, level })` — renderizada dentro do shell (não redireciona).

- [ ] **Step 1: Escrever o teste**

```jsx
// frontend/src/components/ProtectedRoute.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

function renderAt(level, agent, areaLabel = 'Supervisão') {
  useAuth.mockReturnValue({ token: agent ? 'tok' : null, agent });
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <Routes>
        <Route path="/login" element={<p>Login</p>} />
        <Route
          path="/x"
          element={
            <ProtectedRoute level={level} areaLabel={areaLabel}>
              <p>Conteúdo protegido</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ProtectedRoute', () => {
  test('sem token manda para /login', () => {
    renderAt('auth', null);
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  test('atendente entra em nível auth', () => {
    renderAt('auth', { role: 'agent' });
    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
  });

  test('atendente em nível admin vê a página de acesso negado com o nome da área', () => {
    renderAt('admin', { role: 'agent' });
    expect(screen.getByRole('heading', { name: /sem acesso a supervisão/i })).toBeInTheDocument();
    expect(screen.getByText(/administradores e gerentes/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir para o atendimento/i })).toHaveAttribute('href', '/');
  });

  test('gerente sem a flag em nível integrations vê a explicação da permissão', () => {
    renderAt('integrations', { role: 'manager', canManageIntegrations: false }, 'OpenAI');
    expect(screen.getByRole('heading', { name: /sem acesso a openai/i })).toBeInTheDocument();
    expect(screen.getByText(/canais e integrações/i)).toBeInTheDocument();
  });

  test('gerente com a flag entra em nível integrations', () => {
    renderAt('integrations', { role: 'manager', canManageIntegrations: true });
    expect(screen.getByText('Conteúdo protegido')).toBeInTheDocument();
  });

  test('requireAdmin ainda funciona como alias de level admin', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager' } });
    render(
      <MemoryRouter>
        <ProtectedRoute requireAdmin><p>ok</p></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ProtectedRoute.test.jsx`
Expected: FAIL (heading de acesso negado não existe; hoje redireciona para `/`).

- [ ] **Step 3: Implementar**

```jsx
// frontend/src/pages/AccessDeniedPage.jsx
import { Link } from 'react-router-dom';
import { IconLock } from '../components/icons/WaIcons';

const LEVEL_TEXT = {
  admin: 'Esta área é liberada para administradores e gerentes.',
  integrations:
    'Esta área é liberada para administradores e para gerentes com a permissão "Pode gerenciar Canais e Integrações", marcada na conta pelo administrador.',
};

function AccessDeniedPage({ areaLabel = 'esta área', level = 'admin' }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-chat-orange">
        <IconLock size={22} />
      </span>
      <h1 className="font-display text-[24px] font-semibold text-chat-text">Sem acesso a {areaLabel}</h1>
      <p className="mt-2 max-w-[44ch] text-[14px] leading-[20px] text-chat-muted">{LEVEL_TEXT[level] || LEVEL_TEXT.admin}</p>
      <Link
        to="/"
        className="mt-6 rounded-full bg-chat-orange px-5 py-2.5 text-[14px] font-medium text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-chat-orange"
      >
        Ir para o Atendimento
      </Link>
    </div>
  );
}

export default AccessDeniedPage;
```

```jsx
// frontend/src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasLevel } from '../navigation/navItems';
import AccessDeniedPage from '../pages/AccessDeniedPage';

// `requireAdmin` é o nome antigo; vale como level="admin" até todos os usos
// migrarem para `level`.
function ProtectedRoute({ children, level, requireAdmin = false, areaLabel }) {
  const { token, agent } = useAuth();
  const effectiveLevel = level || (requireAdmin ? 'admin' : 'auth');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (!hasLevel(agent, effectiveLevel)) {
    return <AccessDeniedPage areaLabel={areaLabel} level={effectiveLevel} />;
  }
  return children;
}

export default ProtectedRoute;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ProtectedRoute.test.jsx`
Expected: PASS (6 testes).

- [ ] **Step 5: Ajustar o App.test.jsx que esperava redirecionamento**

Em `frontend/src/App.test.jsx`, o teste "an already-authenticated non-admin visiting /admin/channels is redirected to the dashboard" passa a se chamar "an already-authenticated non-admin visiting /admin/channels sees the access denied page" e a asserção final vira:

```jsx
    expect(await screen.findByRole('heading', { name: /sem acesso/i })).toBeInTheDocument();
    expect(screen.queryByText(/Selecione uma conversa/i)).not.toBeInTheDocument();
```

(Na Task 7 o `/admin/channels` passa a redirecionar para `/configuracoes/canais`, e o heading continua sendo o de acesso negado.)

Run: `cd frontend && npx vitest run src/App.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ProtectedRoute.jsx frontend/src/components/ProtectedRoute.test.jsx frontend/src/pages/AccessDeniedPage.jsx frontend/src/App.test.jsx
git commit -m "Guard routes by access level and show an access-denied page instead of a silent redirect

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Primitivos de interface (`components/ui`)

**Files:**
- Create: `frontend/src/components/ui/Button.jsx`, `Card.jsx`, `Field.jsx`, `Toggle.jsx`, `ScopeBadge.jsx`, `HelpText.jsx`, `Tabs.jsx`, `PageHeader.jsx`, `DangerZone.jsx`, `index.js`
- Test: `frontend/src/components/ui/ui.test.jsx`

**Interfaces (Produces):**
- `Button({ variant = 'primary'|'secondary'|'danger'|'ghost', loading, type = 'button', ...rest })`.
- `Card({ title, description, scope, footer, children, tone = 'default'|'warn' })`.
- `Field({ id, label, help, error, children })` — envolve um input já com `id`; adiciona `aria-describedby`/`aria-invalid` no filho via `cloneElement`.
- `Toggle({ id, checked, onChange, label, description, disabled, disabledReason })` — `disabledReason` obrigatório quando `disabled` (renderizado como texto com `id={id}-reason` ligado por `aria-describedby`).
- `ScopeBadge({ scope: 'global'|'channel'|'inherited'|'depends', detail })` → texto "Toda a operação" / "Este canal" / `Herdado de ${detail}` / `Depende de ${detail}`.
- `HelpText({ children })`.
- `Tabs({ tabs: [{ key, label, to?, count? }], active, onChange })` — se `to` existe vira `<NavLink>`; senão `<button role="tab">`. Setas ←/→ movem o foco.
- `PageHeader({ title, description, action, crumbs: [{ label, to? }] })`.
- `DangerZone({ title = 'Ações com cuidado', children })`.
- `inputClass` exportado de `index.js` para inputs nativos: `'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25'` (o mesmo que hoje se repete em 8 arquivos).

- [ ] **Step 1: Escrever o teste**

```jsx
// frontend/src/components/ui/ui.test.jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Button, Card, Field, Toggle, ScopeBadge, Tabs, PageHeader, DangerZone } from './index';

describe('ui primitives', () => {
  test('Button loading fica desabilitado e anuncia ocupado', () => {
    render(<Button loading>Salvar</Button>);
    const button = screen.getByRole('button', { name: /salvar/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  test('Card mostra título, descrição, selo de escopo e rodapé', () => {
    render(
      <Card title="Empresa" description="Nome e comprovantes" scope="global" footer={<Button>Salvar empresa</Button>}>
        <p>corpo</p>
      </Card>
    );
    expect(screen.getByRole('heading', { name: 'Empresa' })).toBeInTheDocument();
    expect(screen.getByText('Nome e comprovantes')).toBeInTheDocument();
    expect(screen.getByText('Toda a operação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar empresa' })).toBeInTheDocument();
  });

  test('Field liga rótulo, ajuda e erro ao campo', () => {
    render(
      <Field id="nome" label="Nome" help="Como aparece no menu" error="Obrigatório">
        <input id="nome" />
      </Field>
    );
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('nome-help');
    expect(input.getAttribute('aria-describedby')).toContain('nome-error');
    expect(screen.getByText('Obrigatório')).toBeInTheDocument();
  });

  test('Toggle desabilitado explica o porquê', () => {
    render(<Toggle id="noturno" checked={false} onChange={() => {}} label="Atendimento noturno" disabled disabledReason="Precisa da triagem com IA ligada" />);
    const box = screen.getByRole('checkbox', { name: /atendimento noturno/i });
    expect(box).toBeDisabled();
    expect(box.getAttribute('aria-describedby')).toContain('noturno-reason');
    expect(screen.getByText('Precisa da triagem com IA ligada')).toBeInTheDocument();
  });

  test('ScopeBadge mostra os quatro escopos', () => {
    const { rerender } = render(<ScopeBadge scope="channel" />);
    expect(screen.getByText('Este canal')).toBeInTheDocument();
    rerender(<ScopeBadge scope="inherited" detail="Atendimento noturno" />);
    expect(screen.getByText('Herdado de Atendimento noturno')).toBeInTheDocument();
    rerender(<ScopeBadge scope="depends" detail="OpenAI" />);
    expect(screen.getByText('Depende de OpenAI')).toBeInTheDocument();
  });

  test('Tabs por botão marca a aba ativa e navega com setas', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[{ key: 'a', label: 'Conexão' }, { key: 'b', label: 'Atendimento', count: 2 }]} active="a" onChange={onChange} />);
    const first = screen.getByRole('tab', { name: /conexão/i });
    expect(first).toHaveAttribute('aria-selected', 'true');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('Tabs por rota viram links', () => {
    render(
      <MemoryRouter initialEntries={['/x/conexao']}>
        <Tabs tabs={[{ key: 'conexao', label: 'Conexão', to: '/x/conexao' }, { key: 'atendimento', label: 'Atendimento', to: '/x/atendimento' }]} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /conexão/i })).toHaveAttribute('aria-current', 'page');
  });

  test('PageHeader mostra breadcrumb, título e ação', () => {
    render(
      <MemoryRouter>
        <PageHeader crumbs={[{ label: 'Configurações', to: '/configuracoes' }, { label: 'Canais' }]} title="Canais" description="Os números ligados" action={<Button>Criar canal</Button>} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Canais' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar canal' })).toBeInTheDocument();
  });

  test('DangerZone tem título próprio', () => {
    render(<DangerZone><Button variant="danger">Excluir</Button></DangerZone>);
    expect(screen.getByRole('heading', { name: /ações com cuidado/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/ui.test.jsx`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar os arquivos**

```jsx
// frontend/src/components/ui/Button.jsx
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[14px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const VARIANTS = {
  primary: 'bg-wa-green text-white hover:bg-wa-green-dark focus-visible:outline-wa-green',
  secondary: 'border border-wa-border bg-wa-field text-wa-text hover:bg-wa-panel focus-visible:outline-wa-green',
  danger: 'border border-wa-error-text/30 bg-wa-error-bg text-wa-error-text hover:brightness-110 focus-visible:outline-wa-error-text',
  ghost: 'text-wa-muted hover:bg-wa-hover hover:text-wa-text focus-visible:outline-wa-green',
};

export function Button({ variant = 'primary', loading = false, type = 'button', className = '', children, disabled, ...rest }) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANTS[variant] || VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
```

```jsx
// frontend/src/components/ui/ScopeBadge.jsx
const LABELS = {
  global: () => 'Toda a operação',
  channel: () => 'Este canal',
  inherited: (detail) => `Herdado de ${detail}`,
  depends: (detail) => `Depende de ${detail}`,
};

export function ScopeBadge({ scope, detail }) {
  const label = (LABELS[scope] || LABELS.global)(detail);
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-wa-border bg-wa-surface-soft px-2.5 py-[3px] text-[12px] font-medium text-wa-muted">
      {label}
    </span>
  );
}
```

```jsx
// frontend/src/components/ui/Card.jsx
import { ScopeBadge } from './ScopeBadge';

const TONES = {
  default: 'border-wa-surface-line bg-wa-surface',
  warn: 'border-wa-warn-text/40 bg-wa-warn-bg',
};

export function Card({ title, description, scope, scopeDetail, footer, tone = 'default', children, as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`rounded-2xl border p-6 backdrop-blur-xl ${TONES[tone] || TONES.default}`} {...rest}>
      {(title || scope) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[16px] font-semibold text-wa-text">{title}</h2>}
            {description && <p className="mt-1 text-[13.5px] leading-[19px] text-wa-muted">{description}</p>}
          </div>
          {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
        </div>
      )}
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-wa-border pt-4">{footer}</div>}
    </Tag>
  );
}
```

```jsx
// frontend/src/components/ui/Field.jsx
import { cloneElement, Children } from 'react';

export function Field({ id, label, help, error, children }) {
  const helpId = help ? `${id}-help` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const child = Children.only(children);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-wa-muted">
        {label}
      </label>
      {cloneElement(child, { 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {help && (
        <p id={helpId} className="mt-1.5 text-[12.5px] leading-[17px] text-wa-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-[12.5px] leading-[17px] text-wa-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
```

```jsx
// frontend/src/components/ui/Toggle.jsx
export function Toggle({ id, checked, onChange, label, description, disabled = false, disabledReason }) {
  const reasonId = disabled && disabledReason ? `${id}-reason` : null;
  const descId = description ? `${id}-desc` : null;
  const describedBy = [descId, reasonId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={describedBy}
        className="mt-[3px] h-4 w-4 shrink-0 accent-wa-green"
      />
      <div className="min-w-0">
        <label htmlFor={id} className={`block text-[14px] ${disabled ? 'text-wa-muted' : 'text-wa-text'}`}>
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-[12.5px] leading-[17px] text-wa-muted">
            {description}
          </p>
        )}
        {reasonId && (
          <p id={reasonId} className="mt-0.5 text-[12.5px] leading-[17px] text-wa-warn-text">
            {disabledReason}
          </p>
        )}
      </div>
    </div>
  );
}
```

```jsx
// frontend/src/components/ui/HelpText.jsx
export function HelpText({ children }) {
  return <p className="text-[12.5px] leading-[17px] text-wa-muted">{children}</p>;
}
```

```jsx
// frontend/src/components/ui/Tabs.jsx
import { NavLink } from 'react-router-dom';

const TAB_BASE =
  'relative shrink-0 rounded-full border px-[18px] py-[9px] text-[14.5px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';
const ACTIVE = 'border-chat-orange/70 text-chat-text';
const IDLE = 'border-white/[0.12] text-chat-muted hover:text-chat-text';

function Count({ value }) {
  if (!value) return null;
  return (
    <span className="absolute -right-2 -top-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-chat-orange px-1 text-[12px] font-semibold text-white">
      {value}
    </span>
  );
}

export function Tabs({ tabs, active, onChange, label = 'Abas' }) {
  function onKeyDown(event, index) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (onChange) onChange(next.key);
    const el = document.getElementById(`tab-${next.key}`);
    if (el) el.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-3.5 overflow-x-auto">
      {tabs.map((tab, index) =>
        tab.to ? (
          <NavLink
            key={tab.key}
            id={`tab-${tab.key}`}
            to={tab.to}
            className={({ isActive }) => `${TAB_BASE} ${isActive ? ACTIVE : IDLE}`}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {tab.label}
            <Count value={tab.count} />
          </NavLink>
        ) : (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`${TAB_BASE} ${active === tab.key ? ACTIVE : IDLE}`}
          >
            {tab.label}
            <Count value={tab.count} />
          </button>
        )
      )}
    </div>
  );
}
```

```jsx
// frontend/src/components/ui/PageHeader.jsx
import { Link } from 'react-router-dom';

export function PageHeader({ title, description, action, crumbs = [] }) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 px-2 pb-4 pt-2">
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <nav aria-label="Você está em" className="mb-1 flex flex-wrap items-center gap-1 text-[12.5px] text-chat-faint">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-chat-text hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                {index < crumbs.length - 1 && <span aria-hidden="true">›</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">{title}</h1>
        {description && <p className="mt-1.5 text-[14px] text-chat-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
```

```jsx
// frontend/src/components/ui/DangerZone.jsx
export function DangerZone({ title = 'Ações com cuidado', description, children }) {
  return (
    <section aria-labelledby="danger-zone-title" className="rounded-2xl border border-wa-error-text/25 bg-wa-surface-soft p-6">
      <h2 id="danger-zone-title" className="font-display text-[15px] font-semibold text-wa-error-text">
        {title}
      </h2>
      {description && <p className="mt-1 text-[13px] text-wa-muted">{description}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
```

```js
// frontend/src/components/ui/index.js
export { Button } from './Button';
export { Card } from './Card';
export { Field } from './Field';
export { Toggle } from './Toggle';
export { ScopeBadge } from './ScopeBadge';
export { HelpText } from './HelpText';
export { Tabs } from './Tabs';
export { PageHeader } from './PageHeader';
export { DangerZone } from './DangerZone';
export { AsyncState } from './AsyncState';
export { ConfirmDialog } from './ConfirmDialog';

export const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text placeholder-wa-muted outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
```

`AsyncState` e `ConfirmDialog` são criados na Task 4; até lá, crie os dois arquivos com um `export function AsyncState() { return null; }` / `export function ConfirmDialog() { return null; }` provisório para o `index.js` resolver.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui/ui.test.jsx`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui
git commit -m "Add the shared UI primitives for the reorganized screens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `AsyncState`, `useAsyncResource` e `ConfirmDialog`/`useConfirm`

**Files:**
- Create: `frontend/src/components/ui/AsyncState.jsx` (substitui o provisório), `frontend/src/components/ui/ConfirmDialog.jsx` (substitui o provisório), `frontend/src/hooks/useAsyncResource.js`, `frontend/src/hooks/useConfirm.jsx`
- Test: `frontend/src/components/ui/AsyncState.test.jsx`, `frontend/src/hooks/useAsyncResource.test.jsx`, `frontend/src/hooks/useConfirm.test.jsx`

**Interfaces (Produces):**
- `AsyncState({ status, error, isEmpty, emptyMessage, onRetry, skeletonLines = 3, children })`: `status ∈ 'loading'|'ready'|'error'|'forbidden'`. `loading` → esqueleto (`role="status"`, texto "Carregando…" só para leitor de tela); `error` → mensagem + botão "Tentar de novo"; `forbidden` → "Você não tem permissão para ver esta lista."; `ready && isEmpty` → `emptyMessage`; `ready` → `children`.
- `useAsyncResource(fetcher, deps, { initial, enabled })` → `{ data, status, error, reloading, refresh, setData }`. `err.status === 403` vira `'forbidden'`. `refresh()` depois do primeiro carregamento não volta ao esqueleto: marca `reloading`.
- `ConfirmDialog({ open, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel })` — `WaDialog` com `role="alertdialog"`, foco inicial no botão cancelar, Esc cancela, devolve o foco ao elemento focado ao abrir.
- `useConfirm()` → `{ confirm(message, { danger, confirmLabel }) => Promise<boolean>, confirmDialog }`. Uso: `if (!(await confirm('Excluir?'))) return;` e renderizar `{confirmDialog}` no fim do componente.

- [ ] **Step 1: Testes**

```jsx
// frontend/src/components/ui/AsyncState.test.jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AsyncState } from './AsyncState';

describe('AsyncState', () => {
  test('loading mostra esqueleto e não mostra o texto de vazio', () => {
    render(<AsyncState status="loading" isEmpty emptyMessage="Nenhum setor cadastrado."><p>lista</p></AsyncState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum setor cadastrado.')).not.toBeInTheDocument();
    expect(screen.queryByText('lista')).not.toBeInTheDocument();
  });
  test('ready e vazio mostra o texto de vazio', () => {
    render(<AsyncState status="ready" isEmpty emptyMessage="Nenhum setor cadastrado."><p>lista</p></AsyncState>);
    expect(screen.getByText('Nenhum setor cadastrado.')).toBeInTheDocument();
  });
  test('ready com dados mostra os filhos', () => {
    render(<AsyncState status="ready" isEmpty={false} emptyMessage="x"><p>lista</p></AsyncState>);
    expect(screen.getByText('lista')).toBeInTheDocument();
  });
  test('error mostra a mensagem e tentar de novo', async () => {
    const onRetry = vi.fn();
    render(<AsyncState status="error" error="Falha de rede" onRetry={onRetry}><p>lista</p></AsyncState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha de rede');
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(onRetry).toHaveBeenCalled();
  });
  test('forbidden explica a falta de permissão', () => {
    render(<AsyncState status="forbidden"><p>lista</p></AsyncState>);
    expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument();
  });
});
```

```jsx
// frontend/src/hooks/useAsyncResource.test.jsx
import { describe, test, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAsyncResource } from './useAsyncResource';

describe('useAsyncResource', () => {
  test('começa em loading e vai para ready com os dados', async () => {
    const fetcher = vi.fn().mockResolvedValue([1, 2]);
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual([1, 2]);
  });
  test('erro genérico vira status error com a mensagem', async () => {
    const fetcher = vi.fn().mockRejectedValue({ status: 500, body: { error: 'quebrou' } });
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('quebrou');
  });
  test('403 vira forbidden', async () => {
    const fetcher = vi.fn().mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });
  test('refresh depois de pronto não volta ao esqueleto', async () => {
    const fetcher = vi.fn().mockResolvedValue([1]);
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { result.current.refresh(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.reloading).toBe(true);
    await waitFor(() => expect(result.current.reloading).toBe(false));
  });
  test('enabled=false fica pronto sem chamar o fetcher', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useAsyncResource(fetcher, [], { initial: [], enabled: false }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.status).toBe('ready');
  });
});
```

```jsx
// frontend/src/hooks/useConfirm.test.jsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirm } from './useConfirm';

function Demo() {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm('Excluir o canal "X"?', { danger: true, confirmLabel: 'Excluir' });
          document.title = ok ? 'sim' : 'nao';
        }}
      >
        Abrir
      </button>
      {confirmDialog}
    </div>
  );
}

describe('useConfirm', () => {
  test('confirmar resolve true e devolve o foco ao botão de origem', async () => {
    render(<Demo />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Excluir o canal "X"?');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(document.title).toBe('sim');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
  test('Esc cancela e resolve false', async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.keyboard('{Escape}');
    expect(document.title).toBe('nao');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/ui/AsyncState.test.jsx src/hooks/useAsyncResource.test.jsx src/hooks/useConfirm.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```jsx
// frontend/src/components/ui/AsyncState.jsx
import { Button } from './Button';

function Skeleton({ lines }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5 py-2">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} aria-hidden="true" className="block h-[14px] animate-pulse rounded-full bg-white/[0.08]" style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function AsyncState({ status, error, isEmpty = false, emptyMessage = 'Nada por aqui ainda.', onRetry, skeletonLines = 3, children }) {
  if (status === 'loading') return <Skeleton lines={skeletonLines} />;
  if (status === 'forbidden') {
    return <p className="rounded-[12px] bg-wa-warn-bg px-3 py-2.5 text-[13.5px] text-wa-warn-text">Você não tem permissão para ver esta lista.</p>;
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-wa-error-bg px-3 py-2.5 text-[13.5px] text-wa-error-text">
        <span>{error || 'Não foi possível carregar.'}</span>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="!py-1.5">
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }
  if (isEmpty) return <p className="py-4 text-[14px] text-wa-muted">{emptyMessage}</p>;
  return children;
}
```

```js
// frontend/src/hooks/useAsyncResource.js
import { useState, useEffect, useCallback, useRef } from 'react';

// Um padrão só de carregamento para hooks de lista e de configuração:
// status separa "ainda não sei" de "não existe" de "deu erro" de "não posso".
export function useAsyncResource(fetcher, deps, { initial = null, enabled = true } = {}) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState(enabled ? 'loading' : 'ready');
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState(null);
  const hasData = useRef(false);

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve();
    if (hasData.current) setReloading(true);
    else setStatus('loading');
    setError(null);
    return fetcher()
      .then((result) => {
        hasData.current = true;
        setData(result);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus(err && err.status === 403 ? 'forbidden' : 'error');
        setError((err && err.body && err.body.error) || (err && err.message) || null);
      })
      .finally(() => setReloading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, status, error, reloading, refresh, setData };
}
```

```jsx
// frontend/src/components/ui/ConfirmDialog.jsx
import { useEffect, useRef } from 'react';
import WaDialog from '../WaDialog';
import { Button } from './Button';

export function ConfirmDialog({ open, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <WaDialog onClose={onCancel} size="max-w-sm">
      <div role="alertdialog" aria-modal="true" aria-describedby="confirm-message" className="px-6 pb-4 pt-5">
        <p id="confirm-message" className="text-[15px] leading-[22px] text-wa-text">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </WaDialog>
  );
}
```

`Button` precisa aceitar `ref`: em `Button.jsx`, `export const Button = forwardRef(function Button({ ... }, ref) { return <button ref={ref} ... /> })`.

```jsx
// frontend/src/hooks/useConfirm.jsx
import { useState, useCallback, useRef } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ message, ...options });
    });
  }, []);

  function settle(value) {
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    if (resolve) resolve(value);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(state)}
      message={state?.message}
      danger={state?.danger}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/ui src/hooks/useAsyncResource.test.jsx src/hooks/useConfirm.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui frontend/src/hooks/useAsyncResource.js frontend/src/hooks/useAsyncResource.test.jsx frontend/src/hooks/useConfirm.jsx frontend/src/hooks/useConfirm.test.jsx
git commit -m "Add AsyncState, useAsyncResource and a focus-restoring confirm dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `SideNav` (três modos) e `AppShell`

**Files:**
- Create: `frontend/src/hooks/useNavCollapsed.js`, `frontend/src/components/SideNav.jsx`, `frontend/src/components/AppShell.jsx`
- Test: `frontend/src/components/SideNav.test.jsx`, `frontend/src/hooks/useNavCollapsed.test.jsx`
- `NavRail.jsx` fica intacto até a Task 18.

**Interfaces:**
- Consumes: `NAV_ITEMS`, `hasLevel` (Task 1); `useQueueNotificationSound`, `useCompanyName`; copiar `iniciaisDaEmpresa` de `NavRail.jsx` para `SideNav.jsx` e exportá-la.
- Produces:
  - `useNavCollapsed()` → `{ collapsed, toggle }`; `localStorage` chave `dw_nav_collapsed` (`'1'`/`'0'`), leitura e escrita em `try/catch`.
  - `SideNav({ onProfileClick, mobileOpen, onMobileClose })` — desktop: `<nav id="sidenav" aria-label="Navegação principal">`, largura `md:w-[232px]` (expandido) ou `md:w-[72px]` (compacto), botão "Recolher menu"/"Expandir menu"; celular: escondido, a não ser que `mobileOpen`, aí vira painel fixo com overlay; fecha ao clicar item, no overlay ou Esc. Rodapé: som, encerrados (só `role === 'agent'`), perfil, sair, avatar. Item ativo por `useMatch`, `aria-current="page"`, `title` sempre presente.
  - `AppShell({ dense })` — `<Outlet context={{ openProfile, profileVersion }} />`, `ProfileModal` próprio, botão "Abrir menu" (`md:hidden`, `data-testid="open-mobile-nav"`). `dense` troca os brilhos para `bg-chat-copper/15` e `/10`.

- [ ] **Step 1: Testes**

```jsx
// frontend/src/hooks/useNavCollapsed.test.jsx
import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavCollapsed } from './useNavCollapsed';

beforeEach(() => localStorage.clear());

describe('useNavCollapsed', () => {
  test('começa expandido e persiste a escolha', () => {
    const { result } = renderHook(() => useNavCollapsed());
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem('dw_nav_collapsed')).toBe('1');
  });
  test('lê a escolha salva', () => {
    localStorage.setItem('dw_nav_collapsed', '1');
    const { result } = renderHook(() => useNavCollapsed());
    expect(result.current.collapsed).toBe(true);
  });
});
```

```jsx
// frontend/src/components/SideNav.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SideNav from './SideNav';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useQueueNotificationSound');
vi.mock('../hooks/useCompanyName');
vi.mock('./ClosedConversationsModal', () => ({
  default: ({ onClose }) => <div role="dialog">encerrados<button onClick={onClose}>x</button></div>,
}));

function renderNav(agent, path = '/', props = {}) {
  useAuth.mockReturnValue({ agent, logout: vi.fn() });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SideNav onProfileClick={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useQueueNotificationSound.mockReturnValue({ muted: false, toggleMuted: vi.fn() });
  useCompanyName.mockReturnValue({ name: 'DW Telecom', status: 'ready' });
});

describe('SideNav', () => {
  test('atendente vê Atendimento, Campanhas e Relatórios; não vê Supervisão nem Configurações', () => {
    renderNav({ role: 'agent' });
    expect(screen.getByRole('link', { name: /atendimento/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /campanhas/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /relatórios/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /supervisão/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /configurações/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /atendimentos encerrados/i })).toBeInTheDocument();
  });

  test('gerente vê Supervisão e Configurações e não vê o botão de encerrados', () => {
    renderNav({ role: 'manager' });
    expect(screen.getByRole('link', { name: /supervisão/i })).toHaveAttribute('href', '/supervisao');
    expect(screen.getByRole('link', { name: /configurações/i })).toHaveAttribute('href', '/configuracoes');
    expect(screen.queryByRole('button', { name: /atendimentos encerrados/i })).not.toBeInTheDocument();
  });

  test('marca o item ativo pela rota', () => {
    renderNav({ role: 'admin' }, '/configuracoes/canais');
    expect(screen.getByRole('link', { name: /configurações/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /atendimento/i })).not.toHaveAttribute('aria-current');
  });

  test('recolher esconde os nomes e mantém o rótulo acessível', async () => {
    renderNav({ role: 'admin' });
    await userEvent.click(screen.getByRole('button', { name: /recolher menu/i }));
    expect(screen.getByRole('button', { name: /expandir menu/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supervisão/i })).toHaveAttribute('title', 'Supervisão');
    expect(localStorage.getItem('dw_nav_collapsed')).toBe('1');
  });

  test('em modo painel, escolher um item fecha o painel', async () => {
    const onMobileClose = vi.fn();
    renderNav({ role: 'admin' }, '/', { mobileOpen: true, onMobileClose });
    await userEvent.click(screen.getByRole('link', { name: /campanhas/i }));
    expect(onMobileClose).toHaveBeenCalled();
  });

  test('em modo painel, Esc fecha', async () => {
    const onMobileClose = vi.fn();
    renderNav({ role: 'admin' }, '/', { mobileOpen: true, onMobileClose });
    await userEvent.keyboard('{Escape}');
    expect(onMobileClose).toHaveBeenCalled();
  });

  test('mostra as iniciais da empresa e o botão de som', () => {
    renderNav({ role: 'agent' });
    expect(screen.getByText('DW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /som ativado/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/SideNav.test.jsx src/hooks/useNavCollapsed.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
// frontend/src/hooks/useNavCollapsed.js
import { useState, useCallback } from 'react';

const KEY = 'dw_nav_collapsed';

function read() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* sem storage: só não persiste */ }
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
```

```jsx
// frontend/src/components/SideNav.jsx
import { useState, useEffect } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueueNotificationSound } from '../hooks/useQueueNotificationSound';
import { useCompanyName } from '../hooks/useCompanyName';
import { useNavCollapsed } from '../hooks/useNavCollapsed';
import { NAV_ITEMS, hasLevel } from '../navigation/navItems';
import ClosedConversationsModal from './ClosedConversationsModal';
import AgentAvatar from './AgentAvatar';
import { IconBellOn, IconBellOff, IconUser, IconLogout, IconCheckCircle, IconChats, IconChevronDown } from './icons/WaIcons';

// Copiada de NavRail.jsx (que some na Task 18).
export function iniciaisDaEmpresa(nome) {
  const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '';
  const primeira = palavras[0];
  if (primeira.length <= 2 && primeira === primeira.toUpperCase()) return primeira;
  return palavras.slice(0, 2).map((palavra) => palavra[0].toUpperCase()).join('');
}

const ITEM_BASE =
  'relative flex h-11 items-center gap-3 rounded-[14px] px-3 text-[14px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

function NavItem({ item, collapsed, onNavigate }) {
  const active = Boolean(useMatch({ path: item.match, end: item.match === '/' }));
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.match === '/'}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`${ITEM_BASE} ${active ? 'bg-white/[0.14] text-chat-text' : 'text-chat-icon hover:bg-white/[0.08] hover:text-chat-text'} ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {active && <span aria-hidden="true" className="absolute -left-3 h-6 w-[3px] rounded-full bg-chat-orange" />}
      <Icon size={22} />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
    </NavLink>
  );
}

function FooterButton({ label, onClick, highlight, collapsed, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${ITEM_BASE} w-full ${highlight ? 'bg-chat-orange/15 text-chat-orange hover:bg-chat-orange/25' : 'text-chat-icon hover:bg-white/[0.08] hover:text-chat-text'} ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {children}
      <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
    </button>
  );
}

function SideNav({ onProfileClick, mobileOpen = false, onMobileClose = () => {} }) {
  const { agent, logout } = useAuth();
  const { muted, toggleMuted } = useQueueNotificationSound();
  const { name: companyName } = useCompanyName();
  const { collapsed, toggle } = useNavCollapsed();
  const [closedOpen, setClosedOpen] = useState(false);
  const iniciais = iniciaisDaEmpresa(companyName);
  const items = NAV_ITEMS.filter((item) => hasLevel(agent, item.level));
  const compact = collapsed && !mobileOpen;

  useEffect(() => {
    if (!mobileOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') onMobileClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {mobileOpen && <div aria-hidden="true" onClick={onMobileClose} className="fixed inset-0 z-30 bg-black/50 md:hidden" />}
      <nav
        id="sidenav"
        aria-label="Navegação principal"
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex w-[264px]' : 'hidden md:flex'} ${collapsed ? 'md:w-[72px]' : 'md:w-[232px]'} shrink-0 flex-col justify-between rounded-r-[26px] border border-white/[0.07] bg-chat-rail/95 px-3 py-5 backdrop-blur-2xl md:relative md:rounded-[26px] md:bg-white/[0.09]`}
      >
        <div className="flex flex-col gap-1.5">
          <div className={`mb-4 flex items-center gap-3 ${compact ? 'justify-center' : 'px-1'}`}>
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.12] font-display text-[14px] font-semibold text-chat-text">
              {iniciais || <IconChats size={22} />}
            </span>
            {!compact && <span className="truncate font-display text-[15px] font-semibold text-chat-text">{companyName}</span>}
          </div>
          {items.map((item) => (
            <NavItem key={item.key} item={item} collapsed={compact} onNavigate={onMobileClose} />
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`${ITEM_BASE} mb-2 hidden text-chat-faint hover:text-chat-text md:flex ${compact ? 'justify-center px-0' : ''}`}
          >
            <span className={`transition ${collapsed ? '-rotate-90' : 'rotate-90'}`}><IconChevronDown size={18} /></span>
            <span className={compact ? 'sr-only' : ''}>{collapsed ? 'Expandir' : 'Recolher'}</span>
          </button>
          <FooterButton label={muted ? 'Som desativado' : 'Som ativado'} onClick={toggleMuted} highlight={muted} collapsed={compact}>
            {muted ? <IconBellOff size={20} /> : <IconBellOn size={20} />}
          </FooterButton>
          {agent?.role === 'agent' && (
            <FooterButton label="Atendimentos encerrados" onClick={() => setClosedOpen(true)} collapsed={compact}>
              <IconCheckCircle size={20} />
            </FooterButton>
          )}
          <FooterButton label="Meu perfil" onClick={onProfileClick} collapsed={compact}>
            <IconUser size={20} />
          </FooterButton>
          <FooterButton label="Sair" onClick={logout} collapsed={compact}>
            <IconLogout size={20} />
          </FooterButton>
          <div className={`mt-2 flex items-center gap-3 ${compact ? 'justify-center' : 'px-1'}`} title={agent?.name || 'Atendente'}>
            <span className="overflow-hidden rounded-[12px] border border-white/20">
              <AgentAvatar agentId={agent?.id} avatarPath={agent?.avatarPath} name={agent?.name} size={40} shape="square" />
            </span>
            {!compact && <span className="truncate text-[13px] text-chat-muted">{agent?.name}</span>}
          </div>
        </div>
      </nav>
      {closedOpen && <ClosedConversationsModal onClose={() => setClosedOpen(false)} />}
    </>
  );
}

export default SideNav;
```

```jsx
// frontend/src/components/AppShell.jsx
import { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import SideNav from './SideNav';
import ProfileModal from './ProfileModal';
import { IconChats } from './icons/WaIcons';

// Casca de todas as páginas autenticadas. `dense` = telas com muito conteúdo
// (Configurações, Supervisão, Relatórios): os brilhos do fundo ficam mais fracos.
// `conversationOpen` vem do Atendimento: com uma conversa aberta no celular, o
// botão de abrir o menu some (o chat ocupa a tela inteira, como hoje).
function AppShell({ dense = false }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const glow = dense ? ['bg-chat-copper/15', 'bg-chat-copper/10'] : ['bg-chat-copper/45', 'bg-chat-copper/25'];

  return (
    <div className="chat-theme relative flex h-dvh overflow-hidden bg-chat-canvas font-sans text-chat-text">
      <div aria-hidden="true" className={`pointer-events-none absolute left-[38%] -top-[10%] h-[38rem] w-[42rem] rounded-full ${glow[0]} blur-[150px]`} />
      <div aria-hidden="true" className={`pointer-events-none absolute -right-[6%] bottom-[-15%] h-[30rem] w-[32rem] rounded-full ${glow[1]} blur-[150px]`} />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 gap-3 p-0 md:p-3">
        <SideNav onProfileClick={openProfile} mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menu"
            aria-controls="sidenav"
            aria-expanded={mobileNavOpen}
            data-testid="open-mobile-nav"
            className={`m-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.10] text-chat-text ${conversationOpen ? 'hidden' : 'md:hidden'}`}
          >
            <IconChats size={22} />
          </button>
          <Outlet context={{ openProfile, closeMobileNav, profileVersion, setConversationOpen }} />
        </div>
      </div>
      {profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} onProfileUpdated={() => setProfileVersion((v) => v + 1)} />
      )}
    </div>
  );
}

export default AppShell;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd frontend && npx vitest run src/components/SideNav.test.jsx src/hooks/useNavCollapsed.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SideNav.jsx frontend/src/components/SideNav.test.jsx frontend/src/components/AppShell.jsx frontend/src/hooks/useNavCollapsed.js frontend/src/hooks/useNavCollapsed.test.jsx
git commit -m "Add the three-mode SideNav and the AppShell layout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Rotas novas, aninhadas, com redirecionamentos

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `frontend/src/pages/settings/SettingsLayout.jsx` (mínimo; completado na Task 13), `frontend/src/pages/settings/SettingsIndex.jsx`
- Test: `frontend/src/App.routes.test.jsx` (novo)

**Interfaces:**
- Consumes: `AppShell`, `ProtectedRoute level`, `LEGACY_REDIRECTS`, `firstAllowedSettingsPath`.
- Produces: árvore de rotas. Até as páginas novas existirem: `/configuracoes/*` renderiza `AdminChannelsPage` (provisório, trocado nas Tasks 13–18); `/supervisao` → `AttendanceDashboardPage`; `/relatorios` → `MetricsPage`; `/campanhas` → `CampaignsPage`; `/campanhas/:id` → `CampaignDetailPage`.
- `LegacyRedirect({ to })`: `useParams()` + `useLocation()`; substitui `:id` e preserva `search`; `<Navigate replace>`.

- [ ] **Step 1: Teste de rotas**

```jsx
// frontend/src/App.routes.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import * as api from './services/api';
import { io } from 'socket.io-client';

vi.mock('./services/api');
vi.mock('socket.io-client');

function loginAs(agent) {
  localStorage.setItem('dw_token', 'tok-123');
  localStorage.setItem('dw_agent', JSON.stringify(agent));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  io.mockReturnValue({ on: vi.fn(), off: vi.fn(), close: vi.fn() });
  api.getPublicCompany.mockResolvedValue({ name: 'Provedor X' });
  api.getQueue.mockResolvedValue([]);
  api.getMyConversations.mockResolvedValue([]);
  api.listChannels.mockResolvedValue([]);
  api.listAgents.mockResolvedValue([]);
  api.listSectors.mockResolvedValue([]);
  api.getDashboardConversations.mockResolvedValue({ inProgress: [], waiting: [], inAutomation: [], closedTodayCount: 0 });
  api.getDashboardClosedToday.mockResolvedValue({ items: [], hasMore: false });
  api.listCampaigns.mockResolvedValue([]);
  api.getMetrics.mockResolvedValue({ period: 'today', scope: 'agent', own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null } });
});

describe('rotas', () => {
  test('/admin/dashboard redireciona para /supervisao preservando a query', async () => {
    loginAs({ id: 'a1', role: 'admin' });
    window.history.pushState({}, '', '/admin/dashboard?canal=ch1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /dashboard de atendimento|supervisão/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/supervisao');
    expect(window.location.search).toBe('?canal=ch1');
  });

  test('/metrics redireciona para /relatorios', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/metrics');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /relatório/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/relatorios');
  });

  test('/campaigns/abc redireciona para /campanhas/abc', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    api.getCampaign.mockResolvedValue({ id: 'abc', name: 'Promo', sentCount: 0, failedCount: 0, skippedCount: 0, totalRecipients: 0, processedCount: 0, recipients: [] });
    window.history.pushState({}, '', '/campaigns/abc');
    render(<App />);
    expect(await screen.findByText('Promo')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/campanhas/abc');
  });

  test('/configuracoes leva o admin à primeira página permitida', async () => {
    loginAs({ id: 'a1', role: 'admin' });
    window.history.pushState({}, '', '/configuracoes');
    render(<App />);
    await screen.findByRole('navigation', { name: /navegação principal/i });
    expect(window.location.pathname).toBe('/configuracoes/canais');
  });

  test('atendente em /supervisao vê acesso negado dentro do shell', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/supervisao');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /sem acesso a supervisão/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeInTheDocument();
  });

  test('o menu marca Relatórios como ativo em /relatorios', async () => {
    loginAs({ id: 'a1', role: 'agent' });
    window.history.pushState({}, '', '/relatorios');
    render(<App />);
    expect(await screen.findByRole('link', { name: /relatórios/i })).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/App.routes.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```jsx
// frontend/src/pages/settings/SettingsIndex.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { firstAllowedSettingsPath } from '../../navigation/navItems';
import AccessDeniedPage from '../AccessDeniedPage';

function SettingsIndex() {
  const { agent } = useAuth();
  const to = firstAllowedSettingsPath(agent);
  if (!to) return <AccessDeniedPage areaLabel="Configurações" level="admin" />;
  return <Navigate to={to} replace />;
}

export default SettingsIndex;
```

```jsx
// frontend/src/pages/settings/SettingsLayout.jsx  (mínimo; a Task 13 completa)
import { Outlet } from 'react-router-dom';

function SettingsLayout() {
  return <Outlet />;
}

export default SettingsLayout;
```

```jsx
// frontend/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminChannelsPage from './pages/AdminChannelsPage';
import MetricsPage from './pages/MetricsPage';
import AttendanceDashboardPage from './pages/AttendanceDashboardPage';
import CampaignsPage from './pages/CampaignsPage';
import CampaignDetailPage from './pages/CampaignDetailPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import SettingsIndex from './pages/settings/SettingsIndex';
import { LEGACY_REDIRECTS } from './navigation/navItems';

// Rota antiga → nova, trocando :params e mantendo ?query.
function LegacyRedirect({ to }) {
  const params = useParams();
  const location = useLocation();
  const target = to.replace(/:([A-Za-z]+)/g, (_, key) => params[key] || '');
  return <Navigate to={`${target}${location.search}`} replace />;
}

function Shell({ dense = false }) {
  return (
    <ProtectedRoute level="auth">
      <AppShell dense={dense} />
    </ProtectedRoute>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<Shell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/campanhas" element={<CampaignsPage />} />
              <Route path="/campanhas/:id" element={<CampaignDetailPage />} />
            </Route>

            <Route element={<Shell dense />}>
              <Route path="/relatorios" element={<MetricsPage />} />
              <Route
                path="/supervisao"
                element={
                  <ProtectedRoute level="admin" areaLabel="Supervisão">
                    <AttendanceDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/configuracoes"
                element={
                  <ProtectedRoute level="admin" areaLabel="Configurações">
                    <SettingsLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<SettingsIndex />} />
                {/* Provisório até as Tasks 13–18: tudo cai na página antiga. */}
                <Route path="*" element={<AdminChannelsPage />} />
              </Route>
            </Route>

            {LEGACY_REDIRECTS.map((r) => (
              <Route key={r.from} path={r.from} element={<LegacyRedirect to={r.to} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

As páginas atuais ainda renderizam o próprio `NavRail` e a própria casca; dentro do `AppShell` isso duplica até as Tasks 8–10 tirarem a casca delas. Aceitável nesta task: os testes de rota olham só heading e URL. Como agora há dois menus (`NavRail` e `SideNav`), o teste "o menu marca Relatórios como ativo" pode achar dois links `/relatórios/i`; use `findAllByRole(...)` e verifique `some(el => el.getAttribute('aria-current') === 'page')` até a Task 10.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/App.routes.test.jsx src/App.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.routes.test.jsx frontend/src/pages/settings
git commit -m "Route the app through AppShell with the new paths and legacy redirects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Atendimento sobre o shell e nomes das abas

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx`, `frontend/src/components/QueueList.jsx`, `frontend/src/components/MyConversationsList.jsx`
- Test: `frontend/src/pages/DashboardPage.test.jsx` (ajustar textos das abas)

**Interfaces:**
- Consumes: `useOutletContext()` → `{ openProfile, profileVersion, setConversationOpen }` (Task 5).
- Produces: `DashboardPage` sem casca própria (sem `chat-theme`, sem brilhos, sem `NavRail`, sem `ProfileModal`).

- [ ] **Step 1: Ajustar os testes existentes**

Em `frontend/src/pages/DashboardPage.test.jsx`, todo `getByRole('tab', { name: /andamento/i })` continua válido ("Em andamento" casa com `/andamento/i`); troque asserções de texto exato `'Andamento'`, `'Espera'`, `'Automação'` por `'Em andamento'`, `'Em espera'`, `'Em automação'`, e `'Nenhuma conversa aguardando.'` por `'Nenhum atendimento em espera.'`, `'Nenhuma conversa em triagem automática.'` por `'Nenhum atendimento em automação.'`, `'Nenhuma conversa atribuída.'` por `'Nenhum atendimento em andamento.'`. Como a página deixa de ter `NavRail`, envolva o render em um `<Routes><Route element={<Outlet context={{ openProfile: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn() }} />}><Route path="/" element={<DashboardPage />} /></Route></Routes>` dentro do `MemoryRouter` (crie um helper `renderInShell(ui)` em `frontend/src/test-utils/renderInShell.jsx`):

```jsx
// frontend/src/test-utils/renderInShell.jsx
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { vi } from 'vitest';

export function renderInShell(ui, { path = '/', initialEntries = [path], context = {} } = {}) {
  const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0, setConversationOpen: vi.fn(), ...context };
  return {
    ctx,
    ...render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<Outlet context={ctx} />}>
            <Route path={path} element={ui} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}
```

Acrescente ao teste do Dashboard:

```jsx
  test('abre "Meu perfil" pelo contexto do shell e avisa quando uma conversa está aberta', async () => {
    api.getQueue.mockResolvedValue([]);
    api.getMyConversations.mockResolvedValue([{ id: 'c1', contactDisplayName: 'Ana', status: 'assigned', channelId: 'ch1' }]);
    const { ctx } = renderInShell(<DashboardPage />);
    await userEvent.click(await screen.findByText('Ana'));
    expect(ctx.setConversationOpen).toHaveBeenLastCalledWith(true);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx`
Expected: FAIL (textos e contexto).

- [ ] **Step 3: Implementar**

Em `DashboardPage.jsx`:

```jsx
const TABS = [
  { value: 'inProgress', label: 'Em andamento' },
  { value: 'waiting', label: 'Em espera' },
  { value: 'automation', label: 'Em automação' },
];
```

Remover imports de `NavRail`, `ProfileModal`; acrescentar `import { useOutletContext } from 'react-router-dom';`. No corpo:

```jsx
  const { profileVersion, setConversationOpen } = useOutletContext();
  useEffect(() => {
    setConversationOpen(Boolean(selectedConversation));
    return () => setConversationOpen(false);
  }, [Boolean(selectedConversation), setConversationOpen]);
```

Remover `profileOpen`, `teamPanelKey` e o `{profileOpen && <ProfileModal .../>}`; `TeamPanel` passa a receber `key={profileVersion}`. O JSX raiz vira:

```jsx
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-testid="channel-banner-wrapper" className={`relative ${selectedConversation ? 'hidden md:block' : ''}`}>
        <ChannelStatusBanner />
      </div>
      <div className="flex min-h-0 flex-1 gap-0 md:gap-3">
        <aside ...>{/* igual, sem mudança */}</aside>
        <main ...>{/* igual */}</main>
      </div>
      {transferringId && ...}
      {startingConversation && ...}
    </div>
  );
```

(remover os dois `<div aria-hidden className="... bg-chat-copper ...">` e o `<NavRail .../>`).

`QueueList.jsx`: `emptyMessage = 'Nenhum atendimento em espera.'`. As duas chamadas em `DashboardPage` passam `emptyMessage="Nenhum atendimento em espera."` e `"Nenhum atendimento em automação."`. `MyConversationsList.jsx`: texto `'Nenhum atendimento em andamento.'`.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx src/App.test.jsx src/App.routes.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/DashboardPage.test.jsx frontend/src/components/QueueList.jsx frontend/src/components/MyConversationsList.jsx frontend/src/test-utils/renderInShell.jsx
git commit -m "Render Atendimento inside AppShell and align the tab names

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Supervisão — shell, filtros na URL, "Setores"

**Files:**
- Rename: `frontend/src/pages/AttendanceDashboardPage.jsx` → `frontend/src/pages/SupervisionPage.jsx` (e o `.test.jsx`); `git mv` para manter histórico.
- Modify: `frontend/src/App.jsx` (import), `frontend/src/pages/SupervisionPage.jsx`
- Test: `frontend/src/pages/SupervisionPage.test.jsx`

**Interfaces:**
- Produces: `SupervisionPage` lê/escreve `?canal=&atendente=&setor=&aba=`. Exporta `AI_AGENT_FILTER`, `isHandledByAi` (iguais). Header via `PageHeader` com título "Supervisão" e descrição "Acompanhe os atendimentos da equipe em tempo real". Abas via `Tabs` (`aba=todos|encerrados`). Colunas "Em andamento / Em espera / Em automação". Filtro "Setores". Texto de vazio da aba encerrados: "Nenhum atendimento encerrado hoje."

- [ ] **Step 1: Testes novos (acrescentar ao arquivo renomeado, que já tem os antigos)**

```jsx
  test('lê os filtros da URL e escreve de volta ao mudar', async () => {
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg' }, { id: 'ch2', name: 'Suporte' }], loading: false });
    useSectors.mockReturnValue({ sectors: [{ id: 's1', name: 'Financeiro' }], loading: false });
    renderInShell(<SupervisionPage />, { path: '/supervisao', initialEntries: ['/supervisao?canal=ch1&aba=encerrados'] });
    expect(await screen.findByRole('tab', { name: /encerrados hoje/i })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^canais/i }));
    expect(screen.getByRole('checkbox', { name: 'Berg' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /^setores/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Financeiro' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('canal=ch1');
    expect(screen.getByTestId('location-search')).toHaveTextContent('setor=s1');
  });
```

Para `location-search`, acrescente ao helper `renderInShell` um componente `<LocationProbe />` que renderiza `<span data-testid="location-search">{useLocation().search}</span>` ao lado do `<Outlet>`.

E troque, nos testes antigos, `label="Departamentos"` / `getByRole('button', { name: /departamentos/i })` por `/setores/i`, "Na automação" por "Em automação", "Nenhuma conversa aguardando." por "Nenhum atendimento em espera.", "Nenhuma conversa em triagem automática." por "Nenhum atendimento em automação.", "Nenhum atendimento encerrado nas últimas 24 horas." por "Nenhum atendimento encerrado hoje.", e o heading `/dashboard de atendimento/i` por `/supervisão/i`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/SupervisionPage.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```bash
git mv frontend/src/pages/AttendanceDashboardPage.jsx frontend/src/pages/SupervisionPage.jsx
git mv frontend/src/pages/AttendanceDashboardPage.test.jsx frontend/src/pages/SupervisionPage.test.jsx
```

Em `SupervisionPage.jsx`:

```jsx
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../components/ui';
// ...
  const [searchParams, setSearchParams] = useSearchParams();
  const channelFilter = searchParams.getAll('canal');
  const agentFilter = searchParams.getAll('atendente');
  const sectorFilter = searchParams.getAll('setor');
  const activeTab = searchParams.get('aba') === 'encerrados' ? 'closed' : 'all';

  function setFilterParam(key, values) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(key);
      values.forEach((v) => next.append(key, v));
      return next;
    }, { replace: true });
  }
  function toggleFilterValue(key, current, value) {
    setFilterParam(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  }
  function setActiveTab(tab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'closed') next.set('aba', 'encerrados'); else next.delete('aba');
      return next;
    }, { replace: true });
  }
```

Remover `useState` de `channelFilter/agentFilter/sectorFilter/activeTab`, `profileOpen`, `NavRail`, `ProfileModal`, a casca `chat-theme` e os brilhos. `FilterDropdown` de "Departamentos" vira `label="Setores"` com `onToggle={(v) => toggleFilterValue('setor', sectorFilter, v)}`; canais → `'canal'`; atendentes → `'atendente'`. Header:

```jsx
<PageHeader title="Supervisão" description="Acompanhe os atendimentos da equipe em tempo real" />
```

Abas:

```jsx
<Tabs
  label="Atendimentos"
  active={activeTab}
  onChange={setActiveTab}
  tabs={[
    { key: 'all', label: 'Todos atendimentos', count: totalActiveCount },
    { key: 'closed', label: 'Encerrados hoje', count: closedCount },
  ]}
/>
```

(`Tabs` renderiza os contadores dentro de um `<span>`; os antigos `data-testid="tab-count-all"/"tab-count-closed"` deixam de existir — ajuste os testes que os usam para `within(screen.getByRole('tab', { name: /todos/i })).getByText('3')`.)

Colunas: `title="Em andamento"` (`emptyMessage="Nenhum atendimento em andamento."`), `"Em espera"` (`"Nenhum atendimento em espera."`), `"Em automação"` (`"Nenhum atendimento em automação."`). Em celular as três colunas viram pilha: troque `flex min-h-0 flex-1 gap-3 overflow-x-auto` por `flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto md:flex-row md:overflow-x-auto` e em `DashboardColumn` `min-w-[300px]` por `md:min-w-[300px]` + `max-h-[40vh] md:max-h-none`.

Em `App.jsx`: `import SupervisionPage from './pages/SupervisionPage';` e usar na rota `/supervisao`.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/pages/SupervisionPage.test.jsx src/App.routes.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/pages frontend/src/App.jsx frontend/src/test-utils
git commit -m "Turn the attendance dashboard into Supervisão with URL filters and Setores

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Relatórios — shell, período na URL, durações legíveis, ajuda dos critérios

**Files:**
- Rename: `frontend/src/pages/MetricsPage.jsx` → `frontend/src/pages/ReportsPage.jsx` (+ test)
- Create: `frontend/src/utils/formatDuration.js`, `frontend/src/utils/formatDuration.test.js`
- Modify: `frontend/src/pages/ReportsPage.jsx`, `frontend/src/App.jsx`
- Test: `frontend/src/pages/ReportsPage.test.jsx`

**Interfaces:**
- Produces: `formatDuration(minutes)` → `'—'` para `null/undefined`; `< 60` → `"45 min"`; `< 1440` → `"1 h 25 min"` (`"2 h"` se 0 min); `≥ 1440` → `"2 d 3 h"`. Arredonda para minuto inteiro. `ReportsPage` lê `?periodo=today|7d|30d|custom&dias=N`. Barras com `sectorId === null` / `reasonId === null` em cinza (`#9a948f`) e nota de rodapé. CSV inalterado.

- [ ] **Step 1: Testes**

```js
// frontend/src/utils/formatDuration.test.js
import { describe, test, expect } from 'vitest';
import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  test('nulo vira travessão', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
  test('menos de uma hora', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(0.4)).toBe('0 min');
    expect(formatDuration(12.5)).toBe('13 min');
  });
  test('horas e minutos', () => {
    expect(formatDuration(85.3)).toBe('1 h 25 min');
    expect(formatDuration(120)).toBe('2 h');
  });
  test('dias e horas', () => {
    expect(formatDuration(3060)).toBe('2 d 3 h');
    expect(formatDuration(1440)).toBe('1 d');
  });
});
```

Acrescentar em `ReportsPage.test.jsx` (arquivo renomeado):

```jsx
  test('mostra tempos legíveis em vez de minutos crus', async () => {
    api.getMetrics.mockResolvedValue({ period: 'today', scope: 'agent', own: { closedCount: 3, avgResolutionMinutes: 85.3, avgFirstResponseMinutes: 4.2 } });
    renderInShell(<ReportsPage />, { path: '/relatorios' });
    expect(await screen.findByText('1 h 25 min')).toBeInTheDocument();
    expect(screen.getByText('4 min')).toBeInTheDocument();
  });

  test('lê o período da URL e escreve ao trocar', async () => {
    api.getMetrics.mockResolvedValue({ period: '7d', scope: 'agent', own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null } });
    renderInShell(<ReportsPage />, { path: '/relatorios', initialEntries: ['/relatorios?periodo=7d'] });
    await waitFor(() => expect(api.getMetrics).toHaveBeenCalledWith('7d', 'tok-123', null));
    await userEvent.click(screen.getByRole('button', { name: /últimos 30 dias/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('periodo=30d');
  });

  test('explica o critério dos tempos', async () => {
    api.getMetrics.mockResolvedValue({ period: 'today', scope: 'agent', own: { closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null } });
    renderInShell(<ReportsPage />, { path: '/relatorios' });
    await userEvent.click(await screen.findByRole('button', { name: /como os tempos são calculados/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/começa quando a conversa é criada/i);
    expect(screen.getByRole('dialog')).toHaveTextContent(/inclui o tempo em espera, na triagem e com a IA/i);
  });

  test('pinta a barra "Sem setor" como sem setor', async () => {
    useAuth.mockReturnValue({ token: 'tok-123', agent: { id: 'admin-1', role: 'admin' } });
    api.getMetrics.mockResolvedValue({
      period: 'today', scope: 'admin',
      byAgent: [{ agentId: 'a1', agentName: 'Ana', closedCount: 2, avgResolutionMinutes: 10, avgFirstResponseMinutes: 2 }],
      bySector: [{ sectorId: null, sectorName: 'Sem setor', closedCount: 2 }],
      byReason: [],
    });
    renderInShell(<ReportsPage />, { path: '/relatorios' });
    expect(await screen.findByText(/"sectorName":"Sem setor"/)).toBeInTheDocument();
    expect(screen.getByText(/encerradas sem setor definido/i)).toBeInTheDocument();
  });
```

Os testes antigos que esperam `'12.5'` e `'4.2'` como texto passam a esperar `'13 min'` e `'4 min'`; os que usam `MemoryRouter` direto passam a usar `renderInShell`; o heading `/relatório/i` continua casando com "Relatórios".

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/utils/formatDuration.test.js src/pages/ReportsPage.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
// frontend/src/utils/formatDuration.js
// Só apresentação: a API continua em minutos e o CSV também.
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return '—';
  const total = Math.round(Number(minutes));
  if (total < 60) return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}
```

```bash
git mv frontend/src/pages/MetricsPage.jsx frontend/src/pages/ReportsPage.jsx
git mv frontend/src/pages/MetricsPage.test.jsx frontend/src/pages/ReportsPage.test.jsx
```

Em `ReportsPage.jsx`:
- Remover `NavRail`, `ProfileModal`, casca e brilhos; raiz vira `<div className="flex min-h-0 flex-1 flex-col">`.
- Header: `<PageHeader title="Relatórios" description="Indicadores de atendimento da equipe" action={<Button variant="secondary" onClick={handleExportCsv} disabled={!data}><IconDownload className="h-4 w-4" />Exportar CSV</Button>} />`.
- Período na URL:

```jsx
  const [searchParams, setSearchParams] = useSearchParams();
  const period = ['today', '7d', '30d', 'custom'].includes(searchParams.get('periodo')) ? searchParams.get('periodo') : 'today';
  const customDays = period === 'custom' ? Number(searchParams.get('dias')) || null : null;
  function selectPeriod(value, days) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('periodo', value);
      if (value === 'custom' && days) next.set('dias', String(days)); else next.delete('dias');
      return next;
    }, { replace: true });
  }
```

`handleApplyCustomDays` → `selectPeriod('custom', customDaysValue)`; os botões de período → `selectPeriod(p.value)`.
- `StatTile` recebe `value={formatDuration(x.avgResolutionMinutes)}` e `label="Tempo médio de atendimento"` (sem "(min)"); idem primeira resposta. `closedCount` continua número.
- Botão de ajuda ao lado da faixa de indicadores:

```jsx
<SectionHelp label="Como os tempos são calculados" title="Como os tempos são calculados">
  <p><strong>Tempo médio de atendimento</strong> começa quando a conversa é criada e termina no encerramento. Inclui o tempo em espera, na triagem e com a IA, e as transferências.</p>
  <p className="mt-2"><strong>Tempo médio de primeira resposta</strong> vai da criação da conversa até a primeira mensagem do atendente depois de assumir. Conversas em que o atendente não respondeu não entram nessa média.</p>
  <p className="mt-2">Os dois números da equipe são médias ponderadas pelo total de atendimentos fechados de cada atendente. O CSV exporta os valores em minutos.</p>
</SectionHelp>
```

(`SectionHelp` renderiza um botão "O que é isso?" com `aria-label="O que é isso: Como os tempos são calculados"` — o teste usa `/como os tempos são calculados/i`, que casa.)
- Gráficos por setor e por motivo: importar `Cell` do recharts e dentro do `<Bar>`:

```jsx
{data.bySector.map((row) => <Cell key={row.sectorId ?? 'none'} fill={row.sectorId === null ? UNSET : INDIGO} />)}
```

com `const UNSET = '#9a948f';`. Abaixo do gráfico, se `data.bySector.some((r) => r.sectorId === null)`: `<p className="mt-2 text-[12.5px] text-chat-faint">"Sem setor" são conversas encerradas sem setor definido na triagem ou pelo atendente.</p>`; idem motivo: `"Sem motivo" são conversas finalizadas direto da fila, sem motivo.` O mock de recharts nos testes precisa de `Cell: () => null`.
- Título do gráfico de tempos: "Tempo médio por atendente" com eixo Y em minutos (`tickFormatter={(v) => `${v} min`}`).

Em `App.jsx`: `import ReportsPage from './pages/ReportsPage';` na rota `/relatorios`. Em `App.test.jsx` / `App.routes.test.jsx` os headings `/relatório/i` continuam válidos.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/utils/formatDuration.test.js src/pages/ReportsPage.test.jsx src/App.routes.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/pages frontend/src/utils/formatDuration.js frontend/src/utils/formatDuration.test.js frontend/src/App.jsx
git commit -m "Turn Relatório into Relatórios with URL period, readable durations and criteria help

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Backend — relatório por setor da conversa e "Sem motivo"

**Files:**
- Modify: `src/metrics/metrics.repository.js:87-135`
- Test: `src/metrics/metrics.repository.test.js:200-238` (trocar expectativa) + testes novos

**Interfaces:**
- Produces: `getMetricsBySector(since)` → `[{ sectorId: uuid|null, sectorName, closedCount }]` agrupado por `conversations.sector_id`, com linha `{ sectorId: null, sectorName: 'Sem setor' }` por último. `getMetricsByReason(since)` → inclui `{ reasonId: null, reasonName: 'Sem motivo' }` quando houver encerramento sem motivo. Mesmo conjunto `closed` de `getMetricsForAllAgents` (só `from_agent_id IS NOT NULL`) para setor; para motivo mantém todos os `closed` (inclui os da IA, como hoje).

- [ ] **Step 1: Trocar e acrescentar testes**

Substituir os dois testes `getMetricsBySector counts a closed conversation toward every sector...` e `...omits an agent who belongs to no sector` por:

```js
  test('getMetricsBySector agrupa pelo setor da conversa, uma vez por conversa', async () => {
    const agent = await createAgent({ email: 'metrics-multisector@dw.com', password: 'secret123', role: 'agent' });
    const financeiro = await createSector({ name: 'Financeiro' });
    const comercial = await createSector({ name: 'Comercial' });
    await setAgentSectors(agent.id, [financeiro.id, comercial.id]);
    const channelId = await seedChannel();

    const conversationId = await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'), closedAt: new Date('2026-01-02T10:30:00Z'), firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });
    await getPool().query('UPDATE conversations SET sector_id = $1 WHERE id = $2', [financeiro.id, conversationId]);

    const metrics = await getMetricsBySector(SINCE);

    expect(metrics).toEqual([{ sectorId: financeiro.id, sectorName: 'Financeiro', closedCount: 1 }]);
  });

  test('getMetricsBySector mostra "Sem setor" para conversa encerrada sem setor, por último', async () => {
    const agent = await createAgent({ email: 'metrics-nosector@dw.com', password: 'secret123', role: 'agent' });
    const suporte = await createSector({ name: 'Suporte' });
    const channelId = await seedChannel();

    const comSetor = await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'), closedAt: new Date('2026-01-02T10:30:00Z'), firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });
    await getPool().query('UPDATE conversations SET sector_id = $1 WHERE id = $2', [suporte.id, comSetor]);
    await seedClosedConversation({
      channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T11:00:00Z'), closedAt: new Date('2026-01-02T11:30:00Z'), firstResponseAt: new Date('2026-01-02T11:05:00Z'),
    });

    const metrics = await getMetricsBySector(SINCE);

    expect(metrics).toEqual([
      { sectorId: suporte.id, sectorName: 'Suporte', closedCount: 1 },
      { sectorId: null, sectorName: 'Sem setor', closedCount: 1 },
    ]);
  });

  test('getMetricsByReason mostra "Sem motivo" para encerramento sem motivo', async () => {
    const agent = await createAgent({ email: 'metrics-noreason@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const senha = await createReason({ name: 'Troca de senha' });
    await seedClosedConversation({ channelId, contactId: await seedContact(), agentId: agent.id, reasonId: senha.id,
      startedAt: new Date('2026-01-02T10:00:00Z'), closedAt: new Date('2026-01-02T10:30:00Z'), firstResponseAt: new Date('2026-01-02T10:05:00Z') });
    await seedClosedConversation({ channelId, contactId: await seedContact(), agentId: agent.id,
      startedAt: new Date('2026-01-02T11:00:00Z'), closedAt: new Date('2026-01-02T11:30:00Z'), firstResponseAt: new Date('2026-01-02T11:05:00Z') });

    const metrics = await getMetricsByReason(SINCE);

    expect(metrics).toEqual([
      { reasonId: senha.id, reasonName: 'Troca de senha', closedCount: 1 },
      { reasonId: null, reasonName: 'Sem motivo', closedCount: 1 },
    ]);
  });
```

`seedClosedConversation` precisa devolver `conversationId` (acrescente `return conversationId;` no fim do helper). Verifique que o teste existente `getMetricsByReason counts closed conversations per reason, ordered by frequency` continua válido (ordem por `closed_count DESC, name ASC`; "Sem motivo" vai para o fim só quando empatar? Não: ver ordenação abaixo).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/metrics/metrics.repository.test.js`
Expected: FAIL nos três testes novos.

- [ ] **Step 3: Implementar**

```js
async function getMetricsBySector(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT c.sector_id
       FROM conversation_events ce
       JOIN conversations c ON c.id = ce.conversation_id
       JOIN agents a ON a.id = ce.from_agent_id
       WHERE ce.event_type = 'closed' AND ce.from_agent_id IS NOT NULL AND ce.created_at >= $1
     )
     SELECT closed.sector_id, COALESCE(s.name, 'Sem setor') AS sector_name, COUNT(*)::int AS closed_count
     FROM closed
     LEFT JOIN sectors s ON s.id = closed.sector_id
     GROUP BY closed.sector_id, s.name
     ORDER BY (closed.sector_id IS NULL) ASC, s.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    sectorId: row.sector_id,
    sectorName: row.sector_name,
    closedCount: Number(row.closed_count),
  }));
}

async function getMetricsByReason(since) {
  const result = await getPool().query(
    `WITH closed AS (
       SELECT ce.reason_id
       FROM conversation_events ce
       WHERE ce.event_type = 'closed' AND ce.created_at >= $1
     )
     SELECT closed.reason_id, COALESCE(r.name, 'Sem motivo') AS reason_name, COUNT(*)::int AS closed_count
     FROM closed
     LEFT JOIN contact_reasons r ON r.id = closed.reason_id
     GROUP BY closed.reason_id, r.name
     ORDER BY (closed.reason_id IS NULL) ASC, closed_count DESC, r.name ASC`,
    [since]
  );
  return result.rows.map((row) => ({
    reasonId: row.reason_id,
    reasonName: row.reason_name,
    closedCount: Number(row.closed_count),
  }));
}
```

Comentário a deixar no arquivo, acima de `getMetricsBySector`: "Agrupa pelo setor da CONVERSA, não pelos setores do atendente: antes, atendente sem setor sumia do gráfico e atendente em dois setores contava duas vezes. NULL vira a barra 'Sem setor' — nenhum setor é atribuído retroativamente."

- [ ] **Step 4: Rodar**

Run: `npm test -- src/metrics`
Expected: PASS (incluindo `metrics.routes.test.js`, que não muda).

- [ ] **Step 5: Commit**

```bash
git add src/metrics/metrics.repository.js src/metrics/metrics.repository.test.js
git commit -m "Group the sector report by the conversation's sector and surface closes without sector or reason

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Campanhas — shell, validação por campo, etapa de revisão, canal na lista

**Files:**
- Create: `frontend/src/utils/parseRecipients.js`, `frontend/src/utils/parseRecipients.test.js`
- Modify: `frontend/src/components/CreateCampaignModal.jsx`, `frontend/src/pages/CampaignsPage.jsx`, `frontend/src/pages/CampaignDetailPage.jsx`, `src/api/campaigns.routes.js:91`
- Test: `frontend/src/components/CreateCampaignModal.test.jsx`, `frontend/src/pages/CampaignsPage.test.jsx`, `frontend/src/pages/CampaignDetailPage.test.jsx`, `src/api/campaigns.routes.test.js`

**Interfaces:**
- Produces: `parseRecipients(raw)` → `{ valid: [{ phoneNumber, displayName }], duplicates: number, invalid: number }` com a mesma regra de `src/api/campaigns.routes.js:31-49` (trim por linha, `\D` removido, dedup por número, linha sem dígito = inválida).
- `CreateCampaignModal` com `step ∈ 'form' | 'review'`. Botão "Revisar" valida; "Confirmar e disparar" chama `createCampaign` com o payload atual (inalterado). O texto cru dos destinatários continua sendo enviado como hoje.
- Backend: `if (!content || !content.trim())` → 400 `content is required`.
- `CampaignsPage`/`CampaignDetailPage` mostram `campaign.channelName` (verificar em `src/campaigns/campaign.repository.js` se a listagem já devolve `channelName`; se devolver só `channelId`, a página resolve o nome via `useChannels()` — `GET /api/channels` — sem mudar a API).

- [ ] **Step 1: Testes**

```js
// frontend/src/utils/parseRecipients.test.js
import { describe, test, expect } from 'vitest';
import { parseRecipients } from './parseRecipients';

describe('parseRecipients', () => {
  test('mesma regra do backend: trim, só dígitos, dedup, inválidos', () => {
    const result = parseRecipients('5511999990000\n 55 (11) 99999-0000 ,Maria\nabc\n\n5511999990001,João, Silva');
    expect(result.valid).toEqual([
      { phoneNumber: '5511999990000', displayName: null },
      { phoneNumber: '5511999990001', displayName: 'João, Silva' },
    ]);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(1);
  });
  test('vazio', () => {
    expect(parseRecipients('')).toEqual({ valid: [], duplicates: 0, invalid: 0 });
  });
});
```

Em `CreateCampaignModal.test.jsx`, os testes "submits a text campaign..." e "shows an error message when creation fails" ganham um passo a mais (clicar em "Revisar" e depois em "Confirmar e disparar") e os novos:

```jsx
  test('não chama a API e mostra erro por campo quando a mensagem está em branco', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), '   ');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Escreva a mensagem que será enviada.')).toBeInTheDocument();
    expect(screen.getByLabelText(/mensagem/i)).toHaveAttribute('aria-invalid', 'true');
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  test('mostra erro quando a lista de destinatários está vazia', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Informe ao menos um destinatário.')).toBeInTheDocument();
  });

  test('canal oficial exige template e variáveis preenchidas', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByLabelText(/variável 1/i);
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText('Preencha a variável 1.')).toBeInTheDocument();
  });

  test('a revisão mostra canal, contagem de destinatários e prévia, sem chamar a API', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Aviso importante');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000\n55 11 99999-0000\nabc');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByRole('heading', { name: /revisar campanha/i })).toBeInTheDocument();
    expect(screen.getByText(/Berg/)).toBeInTheDocument();
    expect(screen.getByText(/Baileys/)).toBeInTheDocument();
    expect(screen.getByText('1 destinatário válido')).toBeInTheDocument();
    expect(screen.getByText('1 duplicado ignorado')).toBeInTheDocument();
    expect(screen.getByText('1 linha inválida')).toBeInTheDocument();
    expect(screen.getByText('Aviso importante')).toBeInTheDocument();
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  test('só dispara em "Confirmar e disparar", com o mesmo payload de antes', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    api.createCampaign.mockResolvedValue({ id: 'campaign-1' });
    const onCreated = vi.fn();
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={onCreated} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Aviso importante');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000\n5511999990001,Maria');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirmar e disparar/i }));
    await waitFor(() =>
      expect(api.createCampaign).toHaveBeenCalledWith(
        { channelId: 'ch-1', name: '', content: 'Aviso importante', recipients: '5511999990000\n5511999990001,Maria' },
        'tok-123'
      )
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 'campaign-1' });
  });

  test('Voltar retorna ao formulário com os campos preservados', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-1', type: 'baileys', name: 'Berg', status: 'connected' }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('Berg');
    await userEvent.type(screen.getByLabelText(/mensagem/i), 'Oi');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));
    expect(screen.getByLabelText(/mensagem/i)).toHaveValue('Oi');
  });

  test('revisão de canal oficial mostra o template e as variáveis', async () => {
    api.listChannelsForAgent.mockResolvedValue([{ id: 'ch-2', type: 'meta_cloud', name: 'Oficial', status: 'connected' }]);
    api.listTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'aviso', variableCount: 1 }]);
    render(<CreateCampaignModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText(/variável 1/i), 'Maria');
    await userEvent.type(screen.getByLabelText(/destinatários/i), '5511999990000');
    await userEvent.click(screen.getByRole('button', { name: /revisar/i }));
    expect(screen.getByText(/template: aviso/i)).toBeInTheDocument();
    expect(screen.getByText(/variável 1: Maria/i)).toBeInTheDocument();
  });
```

Backend, em `src/api/campaigns.routes.test.js`, ao lado do teste de `content is required`:

```js
  test('rejects a whitespace-only content with 400 content is required', async () => {
    // mesmo setup do teste vizinho, com content: '   '
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'content is required' });
  });
```

`CampaignsPage.test.jsx`: os renders passam a `renderInShell(<CampaignsPage />, { path: '/campanhas' })`; acrescentar `expect(await screen.findByText(/Berg/)).toBeInTheDocument()` num teste que mocka `listCampaigns` com `channelName: 'Berg'` (ou `channelId` + `listChannels`). O link do item vira `<Link to={`/campanhas/${id}`}>` (antes era `<a href="/campaigns/...">`) — ajustar `toHaveAttribute('href', '/campanhas/...')`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/utils/parseRecipients.test.js src/components/CreateCampaignModal.test.jsx src/pages/CampaignsPage.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
// frontend/src/utils/parseRecipients.js
// Espelho de parseRecipients em src/api/campaigns.routes.js — só para a
// revisão mostrar contagens; o backend continua sendo a fonte de verdade.
export function parseRecipients(raw) {
  const lines = (raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  let duplicates = 0;
  let invalid = 0;
  for (const line of lines) {
    const [phonePart, ...nameParts] = line.split(',');
    const phoneNumber = (phonePart || '').trim().replace(/\D/g, '');
    const displayName = nameParts.join(',').trim() || null;
    if (!phoneNumber) { invalid += 1; continue; }
    if (seen.has(phoneNumber)) { duplicates += 1; continue; }
    seen.add(phoneNumber);
    valid.push({ phoneNumber, displayName });
  }
  return { valid, duplicates, invalid };
}
```

`CreateCampaignModal.jsx` — acrescentar:

```jsx
import { parseRecipients } from '../utils/parseRecipients';
import { channelTypeLabel } from '../utils/channelTypes';
// ...
  const [step, setStep] = useState('form');
  const [fieldErrors, setFieldErrors] = useState({});
  const RECIPIENT_LIMIT = 2000;

  function validate() {
    const errors = {};
    if (!channelId) errors.channelId = 'Selecione um canal para a campanha.';
    if (isOfficialChannel) {
      if (!templateId) errors.templateId = 'Selecione um template aprovado.';
      templateVariableValues.forEach((value, index) => {
        if (!value || !value.trim()) errors[`variable-${index}`] = `Preencha a variável ${index + 1}.`;
      });
    } else if (!content.trim()) {
      errors.content = 'Escreva a mensagem que será enviada.';
    }
    if (!recipients.trim()) errors.recipients = 'Informe ao menos um destinatário.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleReview(event) {
    event.preventDefault();
    if (!validate()) return;
    setStep('review');
  }

  const summary = parseRecipients(recipients);
```

O `<form onSubmit={handleSubmit}>` vira `onSubmit={handleReview}`; o botão "Disparar" vira `type="submit"` com texto **"Revisar"** (mesmo `disabled`). Cada campo passa a mostrar o erro logo abaixo (`<p className={waErrorClass} id="campaign-message-error">` + `aria-invalid`/`aria-describedby` no input); tire o `required` nativo dos campos (a validação agora é explícita). `handleSubmit` continua idêntico, chamado pelo passo de revisão.

Passo de revisão (renderizado quando `step === 'review'`, no lugar do formulário):

```jsx
<div className="flex min-h-0 flex-1 flex-col">
  <div className="wa-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
    <h3 className="text-[16px] font-medium text-wa-text">Revisar campanha</h3>
    <dl className="space-y-2 text-[14px]">
      <div><dt className={waLabelClass}>Canal</dt><dd className="text-wa-text">{selectedChannel.name} · {channelTypeLabel(selectedChannel.type)}</dd></div>
      <div>
        <dt className={waLabelClass}>Destinatários</dt>
        <dd className="space-y-0.5 text-wa-text">
          <p>{summary.valid.length} {summary.valid.length === 1 ? 'destinatário válido' : 'destinatários válidos'}</p>
          {summary.duplicates > 0 && <p className="text-wa-muted">{summary.duplicates} {summary.duplicates === 1 ? 'duplicado ignorado' : 'duplicados ignorados'}</p>}
          {summary.invalid > 0 && <p className="text-wa-warn-text">{summary.invalid} {summary.invalid === 1 ? 'linha inválida' : 'linhas inválidas'} (vão aparecer como "falhou")</p>}
          {summary.valid.length > RECIPIENT_LIMIT && <p className={waErrorClass}>O limite é de {RECIPIENT_LIMIT} destinatários por campanha.</p>}
        </dd>
      </div>
      <div>
        <dt className={waLabelClass}>Conteúdo</dt>
        <dd className="whitespace-pre-wrap rounded-[10px] bg-wa-panel-header px-3 py-2 text-wa-text">
          {isOfficialChannel ? (
            <>
              <p>Template: {selectedTemplate?.name}</p>
              {templateVariableValues.map((v, i) => <p key={i}>Variável {i + 1}: {v}</p>)}
            </>
          ) : content}
        </dd>
      </div>
    </dl>
    {error && <p className={waErrorClass}>{error}</p>}
  </div>
  <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
    <button type="button" onClick={() => setStep('form')} className={waGhostButtonClass}>Voltar</button>
    <button type="button" onClick={handleSubmit} disabled={submitting || summary.valid.length > RECIPIENT_LIMIT} className={waPrimaryButtonClass}>Confirmar e disparar</button>
  </div>
</div>
```

(`handleSubmit` recebe `event` opcional: troque `event.preventDefault()` por `if (event) event.preventDefault();`.)

`CampaignsPage.jsx`: remover casca/`NavRail`/`ProfileModal`; `PageHeader` com título "Campanhas", descrição atual e `action={<Button onClick={() => setCreating(true)}>Nova campanha</Button>}`; item vira `<Link to={`/campanhas/${campaign.id}`}>` e mostra `campaign.channelName || channelNameById[campaign.channelId]` numa linha "Canal: …"; carregamento/vazio/erro via `AsyncState` (`status` local: `loading` → `'loading'`, erro do `listCampaigns` → `'error'`). `CampaignDetailPage.jsx`: idem, com `PageHeader` (`crumbs=[{ label: 'Campanhas', to: '/campanhas' }, { label: campaign.name || 'Sem nome' }]`) e a linha do canal.

Backend: em `src/api/campaigns.routes.js:91`, `if (!content || !content.trim())`.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/utils/parseRecipients.test.js src/components/CreateCampaignModal.test.jsx src/pages/CampaignsPage.test.jsx src/pages/CampaignDetailPage.test.jsx && cd .. && npm test -- src/api/campaigns.routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/parseRecipients.js frontend/src/utils/parseRecipients.test.js frontend/src/components/CreateCampaignModal.jsx frontend/src/components/CreateCampaignModal.test.jsx frontend/src/pages/CampaignsPage.jsx frontend/src/pages/CampaignsPage.test.jsx frontend/src/pages/CampaignDetailPage.jsx frontend/src/pages/CampaignDetailPage.test.jsx src/api/campaigns.routes.js src/api/campaigns.routes.test.js
git commit -m "Validate campaign fields and add a review step before sending

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `SettingsLayout` completo (menu de segundo nível)

**Files:**
- Modify: `frontend/src/pages/settings/SettingsLayout.jsx`
- Create: `frontend/src/pages/settings/SettingsPage.jsx` (invólucro padrão de cada página de Configurações)
- Test: `frontend/src/pages/settings/SettingsLayout.test.jsx`

**Interfaces:**
- Consumes: `SETTINGS_SECTIONS`, `findSettingsItem`, `hasLevel`.
- Produces:
  - `SettingsLayout`: coluna esquerda com grupos e itens (`<nav aria-label="Seções de configurações">`, `NavLink` com `aria-current`), itens sem nível ficam visíveis mas com `aria-disabled` e um cadeado + `title="Requer permissão de Canais e Integrações"` (o clique leva à página, que mostra `AccessDeniedPage`); em `< md` a coluna vira um `<select aria-label="Seção">` que navega no `onChange`. À direita, `<Outlet />`.
  - `SettingsPage({ title, description, action, scope, scopeDetail, level, children })`: aplica `ProtectedRoute level` (default `'admin'`), monta `PageHeader` com `crumbs=[{ label: 'Configurações', to: '/configuracoes' }, { label: group }]` (grupo obtido por `findSettingsItem(location.pathname)`), `ScopeBadge` ao lado do título, e envolve `children` num `<div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4"><div className="max-w-3xl space-y-6">…</div></div>`.

- [ ] **Step 1: Teste**

```jsx
// frontend/src/pages/settings/SettingsLayout.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SettingsLayout from './SettingsLayout';
import SettingsPage from './SettingsPage';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext');

function renderAt(path, agent) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracoes" element={<SettingsLayout />}>
          <Route path="equipe/setores" element={<SettingsPage title="Setores" description="Os times" scope="global"><p>corpo setores</p></SettingsPage>} />
          <Route path="integracoes/openai" element={<SettingsPage title="OpenAI" level="integrations" scope="global"><p>corpo openai</p></SettingsPage>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('SettingsLayout', () => {
  test('lista os grupos, marca o item ativo e mostra o breadcrumb', () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    expect(screen.getByRole('navigation', { name: /seções de configurações/i })).toBeInTheDocument();
    expect(screen.getByText('Equipe e acesso')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Setores' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Setores' })).toBeInTheDocument();
    expect(screen.getByText('Toda a operação')).toBeInTheDocument();
    expect(screen.getByText('corpo setores')).toBeInTheDocument();
  });

  test('gerente sem a flag vê Integrações com cadeado e recebe acesso negado ao entrar', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'manager', canManageIntegrations: false });
    const link = screen.getByRole('link', { name: /openai/i });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: /sem acesso a openai/i })).toBeInTheDocument();
  });

  test('o select de seção em celular navega', async () => {
    renderAt('/configuracoes/equipe/setores', { role: 'admin' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /seção/i }), '/configuracoes/integracoes/openai');
    expect(await screen.findByText('corpo openai')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/settings/SettingsLayout.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```jsx
// frontend/src/pages/settings/SettingsLayout.jsx
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { SETTINGS_SECTIONS, hasLevel } from '../../navigation/navItems';
import { IconLock } from '../../components/icons/WaIcons';

function SettingsLayout() {
  const { agent } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">
      <aside className="flex min-w-0 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.09] backdrop-blur-2xl md:w-[220px] md:shrink-0">
        <div className="shrink-0 px-3.5 pb-2 pt-4 md:pt-5">
          <h2 className="font-display text-[18px] font-semibold leading-tight text-chat-text">Configurações</h2>
        </div>
        <div className="px-3 pb-3 md:hidden">
          <label htmlFor="settings-section" className="sr-only">Seção</label>
          <select
            id="settings-section"
            value={location.pathname}
            onChange={(e) => navigate(e.target.value)}
            className="w-full rounded-[12px] border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-[14px] text-chat-text"
          >
            {SETTINGS_SECTIONS.map((group) => (
              <optgroup key={group.groupKey} label={group.group}>
                {group.items.map((item) => (
                  <option key={item.key} value={item.to}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <nav aria-label="Seções de configurações" className="chat-scroll hidden min-h-0 flex-1 overflow-y-auto px-1.5 pb-4 md:block">
          {SETTINGS_SECTIONS.map((group) => (
            <div key={group.groupKey}>
              <p className="px-2.5 pb-1 pt-3.5 text-[11.5px] font-medium uppercase tracking-wide text-chat-faint">{group.group}</p>
              {group.items.map((item) => {
                const allowed = hasLevel(agent, item.level);
                return (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    aria-disabled={allowed ? undefined : 'true'}
                    title={allowed ? item.description : 'Requer permissão de Canais e Integrações'}
                    className={({ isActive }) =>
                      `relative flex items-center gap-2 rounded-[12px] px-2.5 py-[7px] text-[14px] transition ${
                        isActive ? 'bg-white/[0.10] font-medium text-chat-text' : 'text-chat-muted hover:bg-white/[0.05] hover:text-chat-text'
                      } ${allowed ? '' : 'opacity-60'}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span aria-hidden="true" className="absolute left-0 h-4 w-[3px] rounded-full bg-chat-orange" />}
                        <span className="truncate">{item.label}</span>
                        {!allowed && <span className="ml-auto shrink-0 text-chat-faint"><IconLock size={13} /></span>}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-[22px] border border-white/[0.07] bg-white/[0.08] backdrop-blur-2xl">
        <Outlet />
      </section>
    </div>
  );
}

export default SettingsLayout;
```

```jsx
// frontend/src/pages/settings/SettingsPage.jsx
import { useLocation } from 'react-router-dom';
import ProtectedRoute from '../../components/ProtectedRoute';
import { PageHeader, ScopeBadge } from '../../components/ui';
import { findSettingsItem, SETTINGS_BASE } from '../../navigation/navItems';

function SettingsPage({ title, description, action, scope, scopeDetail, level = 'admin', wide = false, children }) {
  const location = useLocation();
  const found = findSettingsItem(location.pathname);
  const crumbs = [{ label: 'Configurações', to: SETTINGS_BASE }];
  if (found) crumbs.push({ label: found.group.group });
  return (
    <ProtectedRoute level={level} areaLabel={title}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-white/[0.06] px-4">
          <PageHeader
            crumbs={crumbs}
            title={title}
            description={description}
            action={
              <div className="flex items-center gap-3">
                {scope && <ScopeBadge scope={scope} detail={scopeDetail} />}
                {action}
              </div>
            }
          />
        </div>
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className={`${wide ? 'max-w-5xl' : 'max-w-3xl'} space-y-6`}>{children}</div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default SettingsPage;
```

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/pages/settings/SettingsLayout.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/settings/SettingsLayout.jsx frontend/src/pages/settings/SettingsPage.jsx frontend/src/pages/settings/SettingsLayout.test.jsx
git commit -m "Add the settings layout with the grouped second-level menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Configurações › Equipe, Cadastros e Empresa

**Files:**
- Create: `frontend/src/pages/settings/team/UsersPage.jsx`, `SectorsPage.jsx`, `RolesPage.jsx`; `frontend/src/pages/settings/registers/ReasonsPage.jsx`, `CitiesPage.jsx`; `frontend/src/pages/settings/CompanyPage.jsx`
- Modify: `frontend/src/App.jsx` (rotas), `frontend/src/components/AgentsAdminTab.jsx` (botão "Criar atendente" vira controlado por prop), `frontend/src/components/ReasonsAdminTab.jsx` (selo da IA + confirmação), `frontend/src/components/CitiesAdminTab.jsx`, `frontend/src/components/SectorsAdminTab.jsx` (`useConfirm`)
- Test: `frontend/src/pages/settings/team/RolesPage.test.jsx`, `frontend/src/pages/settings/registers/ReasonsPage.test.jsx`, `frontend/src/pages/settings/team/UsersPage.test.jsx`

**Interfaces:**
- Consumes: `SettingsPage`, `useAiConfig` (para o motivo da IA), `useConfirm`.
- Produces:
  - `UsersPage`: `SettingsPage title="Usuários" description="Quem entra no sistema: atendentes, gerentes e administradores." scope="global" action={<Button onClick={openCreate}>Criar usuário</Button>}` com `<AgentsAdminTab creating={creating} onCreatingChange={setCreating} />`.
  - `AgentsAdminTab` ganha props opcionais `creating`/`onCreatingChange`; sem elas continua com o botão interno (agora "Criar usuário"). Texto de vazio: "Nenhum usuário cadastrado ainda."
  - `SectorsPage`: título "Setores", ação "Cadastrar setor" (controla `CreateSectorForm`).
  - `RolesPage`: tabela gerada de `NAV_ITEMS` + `SETTINGS_SECTIONS` (linhas) × perfis (colunas: Atendente, Gerente, Gerente com credenciais, Administrador) usando `hasLevel` com agentes fictícios; abaixo, lista fixa "Regras que não dependem de página" (texto conforme spec 5.3).
  - `ReasonsPage`: título "Motivos de atendimento", ação "Criar motivo"; `ReasonsAdminTab` recebe `aiResolvedReasonId` (de `useAiConfig().config.triageResolvedReasonId`) e mostra selo "Usado pela IA ao encerrar" na linha; desativar esse motivo passa por `confirm('A IA vai parar de encerrar sozinha até outro motivo ser escolhido. Desativar mesmo assim?')`.
  - `CitiesPage`: título "Cidades", ação "Cadastrar cidade".
  - `CompanyPage`: título "Empresa", `CompanyConfigCard` inteiro; se `acceptedPayeeNames.length === 0` e `status === 'ready'`, `Card tone="warn"` com "Sem nomes aceitos, nenhum comprovante confere."

- [ ] **Step 1: Testes**

```jsx
// frontend/src/pages/settings/team/RolesPage.test.jsx
import { describe, test, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import RolesPage from './RolesPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';

vi.mock('../../../contexts/AuthContext');

describe('RolesPage', () => {
  test('a matriz reflete hasLevel: Supervisão para gerente sim, OpenAI para gerente sem flag não', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    renderInShell(<RolesPage />, { path: '/configuracoes/equipe/perfis' });
    const supervisao = screen.getByRole('row', { name: /supervisão/i });
    expect(within(supervisao).getAllByText('Sim')).toHaveLength(3); // gerente, gerente+flag, admin
    expect(within(supervisao).getAllByText('Não')).toHaveLength(1); // atendente
    const openai = screen.getByRole('row', { name: /openai/i });
    const cells = within(openai).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Não', 'Não', 'Sim', 'Sim']);
  });
  test('lista as regras que não dependem de página', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    renderInShell(<RolesPage />, { path: '/configuracoes/equipe/perfis' });
    expect(screen.getByText(/gerente só cria e edita contas de atendente/i)).toBeInTheDocument();
  });
});
```

```jsx
// frontend/src/pages/settings/registers/ReasonsPage.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReasonsPage from './ReasonsPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useReasonsAdmin } from '../../../hooks/useReasonsAdmin';
import { useAiConfig } from '../../../hooks/useAiConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useReasonsAdmin');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  useReasonsAdmin.mockReturnValue({ reasons: [{ id: 'r1', name: 'Resolvido pela IA', active: true }, { id: 'r2', name: 'Pagamento', active: true }], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
});

describe('ReasonsPage', () => {
  test('marca o motivo que a IA usa ao encerrar', () => {
    renderInShell(<ReasonsPage />, { path: '/configuracoes/cadastros/motivos' });
    expect(screen.getByText('Usado pela IA ao encerrar')).toBeInTheDocument();
  });
  test('desativar o motivo da IA pede confirmação e explica a consequência', async () => {
    api.updateReason.mockResolvedValue({});
    renderInShell(<ReasonsPage />, { path: '/configuracoes/cadastros/motivos' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0]);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/a ia vai parar de encerrar sozinha/i);
    await userEvent.click(screen.getByRole('button', { name: 'Desativar mesmo assim' }));
    expect(api.updateReason).toHaveBeenCalledWith('r1', { active: false }, 'tok');
  });
  test('desativar outro motivo não pede confirmação', async () => {
    api.updateReason.mockResolvedValue({});
    renderInShell(<ReasonsPage />, { path: '/configuracoes/cadastros/motivos' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[1]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.updateReason).toHaveBeenCalledWith('r2', { active: false }, 'tok');
  });
});
```

```jsx
// frontend/src/pages/settings/team/UsersPage.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from './UsersPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useAgentsAdmin } from '../../../hooks/useAgentsAdmin';
import { useSectors } from '../../../hooks/useSectors';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAgentsAdmin');
vi.mock('../../../hooks/useSectors');
vi.mock('../../../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { id: 'admin-1', role: 'admin' } });
  useSectors.mockReturnValue({ sectors: [], status: 'ready', refresh: vi.fn() });
});

describe('UsersPage', () => {
  test('em carregamento não mostra "nenhum usuário"', () => {
    useAgentsAdmin.mockReturnValue({ agents: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<UsersPage />, { path: '/configuracoes/equipe/usuarios' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/nenhum usuário/i)).not.toBeInTheDocument();
  });
  test('a ação do cabeçalho abre o formulário de criação', async () => {
    useAgentsAdmin.mockReturnValue({ agents: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<UsersPage />, { path: '/configuracoes/equipe/usuarios' });
    expect(screen.getByText('Nenhum usuário cadastrado ainda.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /criar usuário/i }));
    expect(screen.getByRole('heading', { name: /cadastrar novo/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/settings`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```jsx
// frontend/src/pages/settings/team/UsersPage.jsx
import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import AgentsAdminTab from '../../../components/AgentsAdminTab';

function UsersPage() {
  const [creating, setCreating] = useState(false);
  return (
    <SettingsPage
      title="Usuários"
      description="Quem entra no sistema: atendentes, gerentes e administradores."
      scope="global"
      action={!creating && <Button onClick={() => setCreating(true)}>Criar usuário</Button>}
    >
      <AgentsAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default UsersPage;
```

`AgentsAdminTab.jsx`: assinatura `function AgentsAdminTab({ creating: creatingProp, onCreatingChange } = {})`; `const controlled = creatingProp !== undefined; const creatingAgent = controlled ? creatingProp : internalCreating; const setCreatingAgent = controlled ? onCreatingChange : setInternalCreating;`. O botão interno só aparece quando `!controlled`, com texto "Criar usuário". A lista passa por `AsyncState` (o hook ganha `status` na Task 18; até lá, `status={loading ? 'loading' : 'ready'}` — ver nota no fim da task). Texto de vazio "Nenhum usuário cadastrado ainda." Nos testes de `AgentsAdminTab.test.jsx`, `/criar atendente/i` vira `/criar usuário/i` e "Nenhum atendente cadastrado ainda." vira "Nenhum usuário cadastrado ainda.".

```jsx
// frontend/src/pages/settings/team/SectorsPage.jsx
import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import SectorsAdminTab from '../../../components/SectorsAdminTab';

function SectorsPage() {
  const [creating, setCreating] = useState(false);
  return (
    <SettingsPage title="Setores" description="Os times para onde um atendimento pode ir. A orientação para a IA ajuda a triagem a escolher o setor certo." scope="global" action={!creating && <Button onClick={() => setCreating(true)}>Cadastrar setor</Button>}>
      <SectorsAdminTab creating={creating} onCreatingChange={setCreating} />
    </SettingsPage>
  );
}

export default SectorsPage;
```

`SectorsAdminTab` recebe as mesmas props controladas que `AgentsAdminTab`; `window.confirm` da exclusão vira `useConfirm` (mesmo texto `Excluir o setor "${sector.name}"?`, `danger: true, confirmLabel: 'Excluir'`), e o teste correspondente troca `window.confirm = vi.fn(() => true)` por clicar no botão "Excluir" do `alertdialog`. Lista via `AsyncState` com `emptyMessage="Nenhum setor cadastrado ainda."`.

`CitiesPage.jsx` e `CitiesAdminTab`: idem (`Cadastrar cidade`; `confirm(`Excluir a cidade "${city.name}"?`)`; vazio "Nenhuma cidade cadastrada ainda.").

```jsx
// frontend/src/pages/settings/team/RolesPage.jsx
import SettingsPage from '../SettingsPage';
import { Card } from '../../../components/ui';
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
  'Atendente vê no Relatório só os próprios números; administrador e gerente veem a equipe toda.',
  'A permissão de credenciais de um gerente só passa a valer no próximo login dele.',
];

function RolesPage() {
  const rows = [
    ...NAV_ITEMS.filter((i) => i.key !== 'configuracoes').map((i) => ({ label: i.label, level: i.level })),
    ...SETTINGS_SECTIONS.flatMap((g) => g.items.map((i) => ({ label: `Configurações › ${i.label}`, level: i.level }))),
    ...EXTRA_ROWS,
  ];
  return (
    <SettingsPage title="Perfis de acesso" description="O que cada perfil pode ver e fazer. Esta tabela é gerada da mesma lista que controla o menu e as rotas." scope="global" wide>
      <Card title="Páginas e ações">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-wa-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Área</th>
                {PROFILES.map((p) => <th key={p.label} scope="col" className="px-3 py-2 font-medium">{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-wa-border">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-wa-text">{row.label}</th>
                  {PROFILES.map((p) => {
                    const ok = hasLevel(p.agent, row.level);
                    return <td key={p.label} className={`px-3 py-2 ${ok ? 'text-wa-chip-text' : 'text-wa-muted'}`}>{ok ? 'Sim' : 'Não'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Regras que não dependem de página" description="Vêm do backend e valem em qualquer tela.">
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-wa-text">
          {FIXED_RULES.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </Card>
    </SettingsPage>
  );
}

export default RolesPage;
```

```jsx
// frontend/src/pages/settings/registers/ReasonsPage.jsx
import { useState } from 'react';
import SettingsPage from '../SettingsPage';
import { Button } from '../../../components/ui';
import ReasonsAdminTab from '../../../components/ReasonsAdminTab';
import { useAiConfig } from '../../../hooks/useAiConfig';

function ReasonsPage() {
  const [creating, setCreating] = useState(false);
  const { config } = useAiConfig();
  return (
    <SettingsPage title="Motivos de atendimento" description="O motivo que o atendente escolhe ao encerrar. Aparece agrupado em Relatórios." scope="global" action={!creating && <Button onClick={() => setCreating(true)}>Criar motivo</Button>}>
      <ReasonsAdminTab creating={creating} onCreatingChange={setCreating} aiResolvedReasonId={config.triageResolvedReasonId || null} />
    </SettingsPage>
  );
}

export default ReasonsPage;
```

`ReasonsAdminTab.jsx`: `ReasonRow` recebe `usedByAi` e mostra `<span className="rounded-full bg-wa-chip px-2 py-[2px] text-[11.5px] font-medium text-wa-chip-text">Usado pela IA ao encerrar</span>` ao lado do nome; `handleToggleActive`:

```jsx
  async function handleToggleActive() {
    if (reason.active && usedByAi) {
      const ok = await confirm('A IA vai parar de encerrar sozinha até outro motivo ser escolhido. Desativar mesmo assim?', { danger: true, confirmLabel: 'Desativar mesmo assim' });
      if (!ok) return;
    }
    // ... resto igual
  }
```

com `const { confirm, confirmDialog } = useConfirm();` e `{confirmDialog}` no JSX da linha. Lista via `AsyncState` (`emptyMessage="Nenhum motivo cadastrado ainda."`); props controladas de criação como nos outros.

```jsx
// frontend/src/pages/settings/CompanyPage.jsx
import SettingsPage from './SettingsPage';
import { Card } from '../../components/ui';
import CompanyConfigCard from '../../components/CompanyConfigCard';
import { useCompanyConfig } from '../../hooks/useCompanyConfig';

function CompanyPage() {
  const { config, status } = useCompanyConfig();
  const semNomes = status === 'ready' && (!config.acceptedPayeeNames || config.acceptedPayeeNames.length === 0);
  return (
    <SettingsPage title="Empresa" description="Nome da empresa e nomes aceitos na conferência de comprovantes." scope="global">
      {semNomes && (
        <Card tone="warn" title="Sem nomes aceitos, nenhum comprovante confere">
          <p className="text-[13.5px] text-wa-text">A IA compara o favorecido do comprovante com esta lista. Cadastre pelo menos a razão social e o nome fantasia.</p>
        </Card>
      )}
      <CompanyConfigCard />
    </SettingsPage>
  );
}

export default CompanyPage;
```

(`CompanyConfigCard` mantém o próprio `useCompanyConfig` interno; duas chamadas ao mesmo GET são aceitáveis aqui e somem na Task 18, quando o cartão passa a aceitar `config`/`status` por prop opcional.)

`App.jsx`: dentro de `<Route path="/configuracoes" ...>`, antes do `path="*"`:

```jsx
<Route path="equipe/usuarios" element={<UsersPage />} />
<Route path="equipe/setores" element={<SectorsPage />} />
<Route path="equipe/perfis" element={<RolesPage />} />
<Route path="cadastros/motivos" element={<ReasonsPage />} />
<Route path="cadastros/cidades" element={<CitiesPage />} />
<Route path="empresa" element={<CompanyPage />} />
```

**Nota sobre `status` antes da Task 18:** os hooks ainda expõem `loading`. Nas páginas desta task, derive `status` assim: `const status = hook.status || (hook.loading ? 'loading' : 'ready');`. A Task 18 remove esse fallback.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/pages/settings src/components/AgentsAdminTab.test.jsx src/components/SectorsAdminTab.test.jsx src/components/CitiesAdminTab.test.jsx src/components/ReasonsAdminTab.test.jsx src/components/CompanyConfigCard.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/settings frontend/src/components/AgentsAdminTab.jsx frontend/src/components/AgentsAdminTab.test.jsx frontend/src/components/SectorsAdminTab.jsx frontend/src/components/SectorsAdminTab.test.jsx frontend/src/components/CitiesAdminTab.jsx frontend/src/components/CitiesAdminTab.test.jsx frontend/src/components/ReasonsAdminTab.jsx frontend/src/components/ReasonsAdminTab.test.jsx frontend/src/App.jsx
git commit -m "Add the Equipe, Cadastros and Empresa settings pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Mensagens e templates + Regras de atendimento (divisão do `MessagesAdminTab`)

**Files:**
- Create: `frontend/src/components/messages/ChannelWelcomeMessageRow.jsx`, `CityNoticeRow.jsx`, `QuickReplyRow.jsx`, `AssignmentMessageSection.jsx`, `BusinessHoursSection.jsx`, `StatusDot.jsx` (o `CityStatusDot` atual)
- Create: `frontend/src/pages/settings/messages/WelcomePage.jsx`, `CityNoticesPage.jsx`, `QuickRepliesPage.jsx`, `TemplatesPage.jsx`; `frontend/src/pages/settings/rules/AssignmentPage.jsx`, `BusinessHoursPage.jsx`
- Delete: `frontend/src/components/MessagesAdminTab.jsx`, `frontend/src/components/MessagesAdminTab.test.jsx` (os testes são redistribuídos, ver Step 1)
- Modify: `frontend/src/App.jsx`, `frontend/src/components/TemplatesAdminTab.jsx` (`useConfirm`, props controladas)
- Test: `frontend/src/components/messages/*.test.jsx` (um por componente extraído), `frontend/src/pages/settings/messages/WelcomePage.test.jsx`

**Interfaces:**
- Cada componente extraído é **o mesmo código** de `MessagesAdminTab.jsx` (linhas 26–757), movido para arquivo próprio, com duas mudanças mecânicas: `window.confirm(...)` → `await confirm(...)` do `useConfirm` (mesmo texto; `{confirmDialog}` no JSX) e `inputClass` importado de `components/ui`. Sem mudança de payload.
- `WelcomePage`: `SettingsPage title="Boas-vindas" scope="channel"` com a lista de canais (`useChannels(true)`) e `ChannelWelcomeMessageRow` por canal. Recebe `canEdit = hasLevel(agent, 'integrations')`; quando `false`, a linha mostra o texto e uma nota "Requer permissão de Canais e Integrações" no lugar dos botões Criar/Editar/Excluir (`ChannelWelcomeMessageRow` ganha prop `readOnly`).
- `CityNoticesPage`: `scope="global"`, aviso "Nenhuma cidade cadastrada ainda. Cadastre cidades em Cadastros › Cidades." com `<Link to="/configuracoes/cadastros/cidades">`.
- `QuickRepliesPage`: ação "Criar resposta rápida"; a lista vem direto na página (sem o modal "Ver mensagens"); `QuickReplyRow` por item.
- `TemplatesPage`: `scope="channel" scopeDetail` implícito; `TemplatesAdminTab` inteiro; se não houver canal oficial, `Card tone="warn"`: "Templates só existem em canais oficiais (Meta Cloud ou 360dialog). Nenhum canal oficial cadastrado."
- `AssignmentPage`: `SettingsPage title="Atribuição" description="Mensagens automáticas ao assumir e ao encerrar um atendimento." scope="global"`, com a ajuda (texto atual do `SectionHelp`, placeholders inclusos) num `Card` de cabeçalho e `AssignmentMessageSection` abaixo.
- `BusinessHoursPage`: título "Horário de atendimento", `Card tone="default"` com "Este horário define quando há atendente humano. A janela em que a IA atende sozinha à noite é outra configuração: Automação e IA › Atendimento noturno." (link) e `BusinessHoursSection`.

- [ ] **Step 1: Redistribuir os testes**

Mover blocos de `MessagesAdminTab.test.jsx` para arquivos por componente, mudando só o `render` (renderizar o componente extraído com as props que ele já recebia) e trocando `window.confirm = vi.fn(() => true|false)` por clicar em "Excluir"/"Cancelar" no `alertdialog`:

| Testes (linhas do arquivo atual) | Destino |
|---|---|
| 53–152 (quick replies) | `components/messages/QuickReplyRow.test.jsx` (edição, cancelar, excluir, recusar, erro) + `pages/settings/messages/QuickRepliesPage.test.jsx` (lista, criar, cancelar criação: 505–540) |
| 154–322 (boas-vindas) | `components/messages/ChannelWelcomeMessageRow.test.jsx` (169–322) + `pages/settings/messages/WelcomePage.test.jsx` (ajuda 154; mais os dois novos abaixo) |
| 324–503 (avisos por cidade) | `components/messages/CityNoticeRow.test.jsx` (345–503) + `pages/settings/messages/CityNoticesPage.test.jsx` (324, 338) |
| 542–690 (atribuição) | `pages/settings/rules/AssignmentPage.test.jsx` |
| 691–fim (horário) | `pages/settings/rules/BusinessHoursPage.test.jsx` |
| 45 (Templates) | `pages/settings/messages/TemplatesPage.test.jsx` |

Testes novos em `WelcomePage.test.jsx`:

```jsx
  test('gerente sem a flag vê a boas-vindas mas não pode editar, com a explicação', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', welcomeMessage: 'Olá!' }], status: 'ready', refresh: vi.fn() });
    renderInShell(<WelcomePage />, { path: '/configuracoes/mensagens/boas-vindas' });
    expect(screen.getByText('Olá!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/requer permissão de canais e integrações/i)).toBeInTheDocument();
  });
  test('em carregamento não some a seção nem mostra vazio', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    useChannels.mockReturnValue({ channels: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<WelcomePage />, { path: '/configuracoes/mensagens/boas-vindas' });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
```

Teste novo em `BusinessHoursPage.test.jsx`:

```jsx
  test('distingue horário humano da janela noturna da IA', () => {
    renderInShell(<BusinessHoursPage />, { path: '/configuracoes/regras/horario' });
    expect(screen.getByRole('link', { name: /atendimento noturno/i })).toHaveAttribute('href', '/configuracoes/automacao/noturno');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/components/messages src/pages/settings/messages src/pages/settings/rules`
Expected: FAIL (módulos ausentes).

- [ ] **Step 3: Implementar**

Extração literal (use `git mv` só para o arquivo de teste principal, se quiser manter histórico; os componentes novos são arquivos novos). Exemplo do padrão de substituição do confirm, em `ChannelWelcomeMessageRow.jsx`:

```jsx
import { useConfirm } from '../../hooks/useConfirm';
// ...
  const { confirm, confirmDialog } = useConfirm();
  async function handleDelete() {
    if (!(await confirm(`Remover a boas-vindas do canal "${channel.name}"?`, { danger: true, confirmLabel: 'Remover' }))) return;
    // ... igual
  }
  // no JSX de cada retorno, antes do </li> final: {confirmDialog}
```

Prop `readOnly` em `ChannelWelcomeMessageRow`: quando `true`, os retornos sem edição trocam os botões por `<span className="text-[12.5px] text-wa-warn-text">Requer permissão de Canais e Integrações</span>`.

Páginas (padrão; as outras seguem igual):

```jsx
// frontend/src/pages/settings/messages/WelcomePage.jsx
import SettingsPage from '../SettingsPage';
import { Card, AsyncState } from '../../../components/ui';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { hasLevel } from '../../../navigation/navItems';
import ChannelWelcomeMessageRow from '../../../components/messages/ChannelWelcomeMessageRow';

function WelcomePage() {
  const { agent } = useAuth();
  const canEdit = hasLevel(agent, 'integrations');
  const { channels, status, error, refresh } = useChannels(true);
  return (
    <SettingsPage title="Boas-vindas" description="A primeira mensagem que cada canal envia ao cliente, antes de qualquer automação." scope="channel">
      <Card title="Por canal" description={canEdit ? undefined : 'Salvar boas-vindas exige a permissão de Canais e Integrações.'}>
        <AsyncState status={status} error={error} onRetry={refresh} isEmpty={channels.length === 0} emptyMessage="Nenhum canal cadastrado. Crie um em Canais WhatsApp.">
          <ul className="divide-y divide-wa-border overflow-hidden rounded-[16px] border border-wa-border bg-wa-surface">
            {channels.map((channel) => (
              <ChannelWelcomeMessageRow key={channel.id} channel={channel} onSaved={refresh} readOnly={!canEdit} />
            ))}
          </ul>
        </AsyncState>
      </Card>
    </SettingsPage>
  );
}

export default WelcomePage;
```

`QuickRepliesPage`: `SettingsPage ... action={!creating && <Button onClick={() => setCreating(true)}>Criar resposta rápida</Button>}`; `{creating && <CreateQuickReplyForm onCreated={...} onCancel={...} />}`; `AsyncState` + `QuickReplyRow` por item.

`AssignmentPage`: `Card title="Como funciona"` com o texto atual do `SectionHelp` (placeholders em `<code>`); depois `<AssignmentMessageSection />`. `BusinessHoursPage`: `Card title="Horário humano × noturno da IA"` com a frase e o `<Link>`; depois `<BusinessHoursSection />`.

`TemplatesPage`: `TemplatesAdminTab` com `useConfirm` no `TemplateRow` (`Excluir o template "${template.name}"?`) e aviso de "nenhum canal oficial" (`channels.filter(isOfficialChannelType).length === 0 && status === 'ready'`).

`App.jsx`, rotas filhas:

```jsx
<Route path="mensagens/boas-vindas" element={<WelcomePage />} />
<Route path="mensagens/avisos-cidade" element={<CityNoticesPage />} />
<Route path="mensagens/respostas-rapidas" element={<QuickRepliesPage />} />
<Route path="mensagens/templates" element={<TemplatesPage />} />
<Route path="regras/atribuicao" element={<AssignmentPage />} />
<Route path="regras/horario" element={<BusinessHoursPage />} />
```

Apagar `MessagesAdminTab.jsx` e `.test.jsx`. `AdminChannelsPage.jsx` ainda importa `MessagesAdminTab`: troque o import por `null` e o ramo `activeTab === 'quickReplies'` por `<p>Movido para Mensagens e templates.</p>` (a página inteira some na Task 17). Em `AdminChannelsPage.test.jsx`, remova o teste "switches to the Mensagens tab…".

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/components/messages src/pages/settings src/components/TemplatesAdminTab.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/messages frontend/src/pages/settings frontend/src/components/MessagesAdminTab.jsx frontend/src/components/MessagesAdminTab.test.jsx frontend/src/components/TemplatesAdminTab.jsx frontend/src/components/TemplatesAdminTab.test.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/pages/AdminChannelsPage.test.jsx frontend/src/App.jsx
git commit -m "Split MessagesAdminTab into the Mensagens and Regras settings pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Integrações (Consulta ao SGP, SGP por canal, OpenAI)

**Files:**
- Create: `frontend/src/components/integrations/SgpIntegrationCard.jsx` (o `IntegrationCard` de `IntegrationsAdminTab.jsx:22-226`, literal), `frontend/src/components/integrations/CreateSgpIntegrationForm.jsx` (o formulário de `IntegrationsAdminTab.jsx:228-360`)
- Create: `frontend/src/pages/settings/integrations/SgpQueryPage.jsx`, `SgpChannelPage.jsx`, `OpenAiPage.jsx`
- Delete: `frontend/src/components/IntegrationsAdminTab.jsx` + test (testes redistribuídos)
- Modify: `frontend/src/App.jsx`, `frontend/src/components/SgpQueryConfigCard.jsx` (texto do botão), `frontend/src/components/OpenAiConfigCard.jsx` (texto do botão)
- Test: `frontend/src/pages/settings/integrations/SgpChannelPage.test.jsx` (testes 48–239 do `IntegrationsAdminTab.test.jsx`, adaptados), `SgpQueryPage.test.jsx`, `OpenAiPage.test.jsx`

**Interfaces:**
- `SgpQueryPage`: `SettingsPage title="Consulta ao SGP" description="O chat consulta cliente, contrato e fatura no SGP: painel na conversa e ferramentas da IA." scope="global" level="integrations"`. `SgpQueryConfigCard` inteiro (botão "Salvar" vira "Salvar consulta ao SGP").
- `SgpChannelPage`: título "SGP por canal", descrição "O SGP dispara mensagens pelo chat com uma chave de API por canal.", `level="integrations"`, ação "Nova integração SGP"; lista de `SgpIntegrationCard`; `Card tone="warn"` "A Consulta ao SGP está desativada; o painel na conversa e a IA não consultam o SGP." quando `useSgpQueryConfig().config.enabled === false && status === 'ready'` (link para `sgp-consulta`).
- `OpenAiPage`: título "OpenAI", `level="integrations"`, `OpenAiConfigCard` (botão "Salvar" → "Salvar OpenAI"); abaixo, `Card title="Usa esta conexão"` com links: Atendimento e triagem com IA, Transcrição de áudio, Atendimento noturno.

- [ ] **Step 1: Testes** — mover os testes 48–239 para `SgpChannelPage.test.jsx` trocando `render(<IntegrationsAdminTab />)` por `renderInShell(<SgpChannelPage />, { path: '/configuracoes/integracoes/sgp-canal' })` e `useAuth` para `{ role: 'admin' }`; o teste 42 (cartão da empresa) some (Empresa tem página própria, Task 13). Novos:

```jsx
// SgpChannelPage.test.jsx (acrescentar)
  test('avisa quando a Consulta ao SGP está desativada', () => {
    useSgpQueryConfig.mockReturnValue({ config: { configured: true, enabled: false }, status: 'ready', refresh: vi.fn() });
    renderInShell(<SgpChannelPage />, { path: '/configuracoes/integracoes/sgp-canal' });
    expect(screen.getByText(/consulta ao sgp está desativada/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /consulta ao sgp/i })).toHaveAttribute('href', '/configuracoes/integracoes/sgp-consulta');
  });
  test('gerente sem a flag vê acesso negado', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    renderInShell(<SgpChannelPage />, { path: '/configuracoes/integracoes/sgp-canal' });
    expect(screen.getByRole('heading', { name: /sem acesso a sgp por canal/i })).toBeInTheDocument();
  });
```

```jsx
// OpenAiPage.test.jsx
  test('mostra o cartão da OpenAI e os atalhos para quem usa a conexão', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
    useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant', model: 'gpt' }, status: 'ready', loading: false, refresh: vi.fn() });
    renderInShell(<OpenAiPage />, { path: '/configuracoes/integracoes/openai' });
    expect(screen.getByRole('heading', { name: /integração com openai/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /salvar openai/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /atendimento e triagem com ia/i })).toHaveAttribute('href', '/configuracoes/automacao/ia');
  });
```

`SgpQueryPage.test.jsx`: um teste "renderiza o cartão com o botão Salvar consulta ao SGP" e um "gerente sem a flag vê acesso negado".

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/settings/integrations`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```jsx
// frontend/src/pages/settings/integrations/SgpChannelPage.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Button, Card, AsyncState } from '../../../components/ui';
import { useSgpIntegrations } from '../../../hooks/useSgpIntegrations';
import { useChannels } from '../../../hooks/useChannels';
import { useTemplates } from '../../../hooks/useTemplates';
import { useSgpQueryConfig } from '../../../hooks/useSgpQueryConfig';
import SgpIntegrationCard from '../../../components/integrations/SgpIntegrationCard';
import CreateSgpIntegrationForm from '../../../components/integrations/CreateSgpIntegrationForm';

function SgpChannelPage() {
  const { integrations, status, error, refresh } = useSgpIntegrations();
  const { channels } = useChannels();
  const { templates } = useTemplates();
  const query = useSgpQueryConfig();
  const [creating, setCreating] = useState(false);
  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');
  const consultaDesligada = query.status === 'ready' && query.config.configured && !query.config.enabled;

  return (
    <SettingsPage
      title="SGP por canal"
      description="O SGP dispara mensagens pelo chat com uma chave de API por canal."
      scope="channel"
      level="integrations"
      action={!creating && <Button onClick={() => setCreating(true)}>Nova integração SGP</Button>}
    >
      {consultaDesligada && (
        <Card tone="warn" title="A Consulta ao SGP está desativada">
          <p className="text-[13.5px] text-wa-text">
            O painel na conversa e a IA não consultam o SGP enquanto ela estiver desligada. Ative em{' '}
            <Link to="/configuracoes/integracoes/sgp-consulta" className="font-medium text-wa-link underline">Consulta ao SGP</Link>.
          </p>
        </Card>
      )}
      {creating && (
        <CreateSgpIntegrationForm channels={channels} integrations={integrations} templates={approvedTemplates} onCreated={() => { setCreating(false); refresh(); }} onCancel={() => setCreating(false)} />
      )}
      <AsyncState status={status} error={error} onRetry={refresh} isEmpty={integrations.length === 0} emptyMessage="Nenhuma integração SGP por canal ainda.">
        <div className="space-y-3">
          {integrations.map((integration) => (
            <SgpIntegrationCard key={integration.id} integration={integration} channels={channels} templates={approvedTemplates} onChanged={refresh} />
          ))}
        </div>
      </AsyncState>
    </SettingsPage>
  );
}

export default SgpChannelPage;
```

`CreateSgpIntegrationForm({ channels, integrations, templates, onCreated, onCancel })`: o formulário atual (estado `description/channelId/defaultTemplateId/enabled`, `eligibleChannels`, `handleCreate` com o mesmo `createSgpIntegration` payload). `SgpIntegrationCard`: código literal do `IntegrationCard`, com "Gerar nova chave" movido para um `DangerZone` no fim do cartão (mesmo handler).

```jsx
// frontend/src/pages/settings/integrations/OpenAiPage.jsx
import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card } from '../../../components/ui';
import OpenAiConfigCard from '../../../components/OpenAiConfigCard';

const USERS = [
  { label: 'Atendimento e triagem com IA', to: '/configuracoes/automacao/ia' },
  { label: 'Transcrição de áudio', to: '/configuracoes/automacao/transcricao' },
  { label: 'Atendimento noturno', to: '/configuracoes/automacao/noturno' },
];

function OpenAiPage() {
  return (
    <SettingsPage title="OpenAI" description="Credencial, modelo e teste de conexão da IA. Só quem tem permissão de credenciais mexe aqui." scope="global" level="integrations">
      <OpenAiConfigCard />
      <Card title="Usa esta conexão" description="Estas automações só funcionam com a OpenAI conectada.">
        <ul className="space-y-1 text-[14px]">
          {USERS.map((u) => <li key={u.to}><Link to={u.to} className="text-wa-link hover:underline">{u.label}</Link></li>)}
        </ul>
      </Card>
    </SettingsPage>
  );
}

export default OpenAiPage;
```

`SgpQueryPage.jsx`: `SettingsPage title="Consulta ao SGP" ... level="integrations"` + `<SgpQueryConfigCard />`. Botões: em `SgpQueryConfigCard.jsx` "Salvar" → "Salvar consulta ao SGP"; em `OpenAiConfigCard.jsx` "Salvar" → "Salvar OpenAI" (ajustar `getByRole('button', { name: /salvar/i })` nos testes desses cartões — continuam casando).

`App.jsx`: rotas `integracoes/sgp-consulta`, `integracoes/sgp-canal`, `integracoes/openai`. Apagar `IntegrationsAdminTab.jsx`/`.test.jsx`; em `AdminChannelsPage.jsx` o ramo final vira `<p>Movido para Integrações.</p>`.

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/pages/settings/integrations src/components/SgpQueryConfigCard.test.jsx src/components/OpenAiConfigCard.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/components/integrations frontend/src/pages/settings/integrations frontend/src/components/IntegrationsAdminTab.jsx frontend/src/components/IntegrationsAdminTab.test.jsx frontend/src/components/SgpQueryConfigCard.jsx frontend/src/components/OpenAiConfigCard.jsx frontend/src/components/SgpQueryConfigCard.test.jsx frontend/src/components/OpenAiConfigCard.test.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/App.jsx
git commit -m "Add the Integrações settings pages and split the SGP gateway card out

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Automação e IA (seis páginas; divisão do cartão de triagem com IA)

**Files:**
- Create: `frontend/src/pages/settings/automation/useAiTriageForm.js`, `AiTriagePage.jsx`, `IdentificationPage.jsx`, `NightModePage.jsx`, `MenuTriagePage.jsx`, `TranscriptionPage.jsx`, `AiToolsPage.jsx`, `aiToolLabels.js`
- Delete: `frontend/src/components/AiTriageConfigCard.jsx` + test (testes redistribuídos)
- Modify: `frontend/src/components/AiToolPermissionsCard.jsx`, `frontend/src/components/TriageAdminTab.jsx` (texto "toggle" → "interruptor", `useConfirm`, props controladas), `frontend/src/components/AudioTranscriptionConfigCard.jsx` (botão "Salvar transcrição"), `frontend/src/App.jsx`
- Test: `useAiTriageForm.test.jsx`, `AiTriagePage.test.jsx`, `IdentificationPage.test.jsx`, `NightModePage.test.jsx`, `AiToolsPage.test.jsx`, `MenuTriagePage.test.jsx`

**Interfaces:**
- `useAiTriageForm()` → `{ status, config, values, setValue(key, v), save(), saving, error, refresh }`. `values` tem os 9 campos em formato de tela (`confidencePercent`, `maxQuestions`, `timeoutMinutes`, `extraInstructions`, `resolvedReasonId`, `requireBirthdate`, `readReceiptsDaytime`, `nightStart`, `nightEnd`) inicializados de `useAiConfig().config` exatamente como `AiTriageConfigCard.jsx:39-52` faz hoje (com os padrões `20:00`/`08:00`). `save()` monta **sempre** o payload de 9 campos igual a `AiTriageConfigCard.jsx:64-78` e chama `updateAiTriageConfig`. Validação de meia janela igual. Cada página edita só os seus campos, mas `save()` manda todos.
- `aiToolLabels.js`: `TOOL_LABELS = { buscar_cliente: 'Localizar cliente por CPF/CNPJ', consultar_status_contrato: 'Consultar situação do contrato', consultar_status_conexao: 'Consultar conexão de internet', consultar_plano: 'Consultar plano contratado', consultar_financeiro: 'Consultar resumo financeiro', consultar_faturas: 'Consultar faturas do contrato', consultar_faturas_todos_contratos: 'Consultar faturas de todos os contratos', consultar_status_todos_contratos: 'Consultar situação de todos os contratos', analisar_comprovante: 'Analisar comprovante de pagamento', confirmar_nascimento: 'Confirmar data de nascimento', definir_motivo_atendimento: 'Registrar motivo do atendimento', transferir_atendimento: 'Transferir para um setor', esquecer_identificacao: 'Esquecer identificação atual', concluir_triagem: 'Concluir triagem', encerrar_atendimento: 'Encerrar atendimento sozinha', gerar_segunda_via: 'Gerar segunda via do boleto', gerar_pix: 'Gerar código PIX', desbloqueio_confianca: 'Liberar em confiança', enviar_boleto: 'Enviar boleto em PDF' }`; `toolLabel(nome)` → rótulo ou o próprio `nome`.
- `AiToolsPage`: grupos "Consulta / Ação / Ação sensível" mantidos; cada linha: `Toggle` com `label={toolLabel(tool.nome)}`, `description={tool.descricao}` e abaixo `<code className="text-[11.5px] text-wa-faint">{tool.nome}</code>`; grava na hora (comportamento atual). Aviso no topo quando `useAiConfig().config.triageResolvedReasonId` existe e a ferramenta `encerrar_atendimento` está desligada: "Encerrar sozinha está configurado, mas a ferramenta Encerrar atendimento sozinha está desligada."
- `AiTriagePage`: cabeçalho de dependências (`Card` "Situação"): OpenAI (`computeStatus` do `OpenAiConfigCard` — exportar a função) com link para Integrações › OpenAI; lista dos canais com `aiEnabled` (`useChannels(true)`), ou "Nenhum canal com IA ligada" com link para Canais. Campos: confiança, máximo de perguntas, tempo limite, instruções, motivo ao encerrar (aviso "O motivo escolhido está inativo ou não existe mais" quando `resolvedReasonId` não está em `useReasons().reasons`). Botão "Salvar triagem com IA".
- `IdentificationPage`: `Toggle` "Exigir data de nascimento depois do CPF" e "Ler comprovantes também de dia (sem desbloqueio)" com as descrições atuais; `HelpText` "A identificação por CPF é sempre feita quando a triagem com IA roda. Os nomes aceitos no comprovante ficam em Empresa." (link). Botão "Salvar identificação".
- `NightModePage`: janela início/fim; `Card` "Canais com noturno ligado" (`aiNightModeEnabled`) ou aviso; frase de distinção com link para Regras › Horário. Botão "Salvar janela noturna".
- `MenuTriagePage`: `TriageAdminTab` com ação "Criar opção"; o aviso vira "Nenhuma opção cadastrada: a triagem por menu não roda em nenhum canal, mesmo com o interruptor ligado."
- `TranscriptionPage`: `AudioTranscriptionConfigCard`; botão "Salvar transcrição"; "Buscar modelos" desabilitado com `title="Salve a chave da OpenAI primeiro"` quando `!config.configured`.

- [ ] **Step 1: Testes**

```jsx
// frontend/src/pages/settings/automation/useAiTriageForm.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAiTriageForm } from './useAiTriageForm';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

const saved = {
  triageConfidenceThreshold: 0.65, triageMaxQuestions: 4, triageTimeoutMinutes: 12, triageExtraInstructions: 'seja breve',
  triageResolvedReasonId: 'r1', nightStartTime: '21:00', nightEndTime: '07:00', triageRequireBirthdate: true, triageReadReceiptsDaytime: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok' });
  useAiConfig.mockReturnValue({ config: saved, status: 'ready', loading: false, refresh: vi.fn() });
  api.updateAiTriageConfig.mockResolvedValue({});
});

describe('useAiTriageForm', () => {
  test('carrega os nove campos da config', () => {
    const { result } = renderHook(() => useAiTriageForm());
    expect(result.current.values).toEqual({
      confidencePercent: 65, maxQuestions: 4, timeoutMinutes: 12, extraInstructions: 'seja breve', resolvedReasonId: 'r1',
      requireBirthdate: true, readReceiptsDaytime: false, nightStart: '21:00', nightEnd: '07:00',
    });
  });
  test('mudar só a janela e salvar envia os nove campos, com os outros intactos', async () => {
    const { result } = renderHook(() => useAiTriageForm());
    act(() => result.current.setValue('nightStart', '20:00'));
    await act(() => result.current.save());
    expect(api.updateAiTriageConfig).toHaveBeenCalledWith(
      {
        triageConfidenceThreshold: 0.65, triageMaxQuestions: 4, triageTimeoutMinutes: 12, triageExtraInstructions: 'seja breve',
        triageResolvedReasonId: 'r1', nightStartTime: '20:00', nightEndTime: '07:00', triageRequireBirthdate: true, triageReadReceiptsDaytime: false,
      },
      'tok'
    );
  });
  test('config sem janela nasce com 20:00 / 08:00', () => {
    useAiConfig.mockReturnValue({ config: { ...saved, nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
    const { result } = renderHook(() => useAiTriageForm());
    expect(result.current.values.nightStart).toBe('20:00');
    expect(result.current.values.nightEnd).toBe('08:00');
  });
  test('meia janela é recusada antes de chamar a API', async () => {
    const { result } = renderHook(() => useAiTriageForm());
    act(() => result.current.setValue('nightEnd', ''));
    await act(() => result.current.save());
    expect(api.updateAiTriageConfig).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/início e fim/i);
  });
  test('motivo vazio vai como null', async () => {
    const { result } = renderHook(() => useAiTriageForm());
    act(() => result.current.setValue('resolvedReasonId', ''));
    await act(() => result.current.save());
    expect(api.updateAiTriageConfig.mock.calls[0][0].triageResolvedReasonId).toBe(null);
  });
});
```

Os testes de `AiTriageConfigCard.test.jsx` (31–252) migram assim: 31/39/68/78/87 → `AiTriagePage.test.jsx`; 107–176 → `IdentificationPage.test.jsx`; 192–252 → `NightModePage.test.jsx`. Em todos, a asserção de `updateAiTriageConfig` continua com os **nove campos**. Testes novos:

```jsx
// AiTriagePage.test.jsx (acrescentar)
  test('mostra a situação da OpenAI com atalho e os canais com IA', () => {
    useAiConfig.mockReturnValue({ config: { ...saved, configured: false, mode: 'assistant' }, status: 'ready', loading: false, refresh: vi.fn() });
    useChannels.mockReturnValue({ channels: [{ id: 'ch1', name: 'Berg', aiEnabled: true }, { id: 'ch2', name: 'Suporte', aiEnabled: false }], status: 'ready' });
    renderInShell(<AiTriagePage />, { path: '/configuracoes/automacao/ia' });
    expect(screen.getByText('Não configurada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /openai/i })).toHaveAttribute('href', '/configuracoes/integracoes/openai');
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByText('Suporte')).not.toBeInTheDocument();
  });
  test('avisa quando o motivo apontado não existe mais', () => {
    useReasons.mockReturnValue({ reasons: [{ id: 'outro', name: 'Outro' }], status: 'ready' });
    renderInShell(<AiTriagePage />, { path: '/configuracoes/automacao/ia' });
    expect(screen.getByText(/motivo escolhido está inativo ou não existe mais/i)).toBeInTheDocument();
  });
  test('o botão diz o que salva', () => {
    renderInShell(<AiTriagePage />, { path: '/configuracoes/automacao/ia' });
    expect(screen.getByRole('button', { name: 'Salvar triagem com IA' })).toBeInTheDocument();
  });
```

```jsx
// AiToolsPage.test.jsx
  test('mostra nome legível, descrição e identificador técnico', async () => {
    useAiTools.mockReturnValue({ tools: [{ nome: 'consultar_status_conexao', categoria: 'CONSULTA', descricao: 'Verifica em tempo real...', enabled: true }], status: 'ready', refresh: vi.fn() });
    renderInShell(<AiToolsPage />, { path: '/configuracoes/automacao/ferramentas' });
    expect(screen.getByRole('checkbox', { name: /consultar conexão de internet/i })).toBeChecked();
    expect(screen.getByText('consultar_status_conexao')).toBeInTheDocument();
    expect(screen.getByText(/verifica em tempo real/i)).toBeInTheDocument();
  });
  test('avisa quando encerrar sozinha está configurado mas a ferramenta está desligada', () => {
    useAiConfig.mockReturnValue({ config: { triageResolvedReasonId: 'r1' }, status: 'ready', loading: false, refresh: vi.fn() });
    useAiTools.mockReturnValue({ tools: [{ nome: 'encerrar_atendimento', categoria: 'ACAO', descricao: '...', enabled: false }], status: 'ready', refresh: vi.fn() });
    renderInShell(<AiToolsPage />, { path: '/configuracoes/automacao/ferramentas' });
    expect(screen.getByText(/ferramenta encerrar atendimento sozinha está desligada/i)).toBeInTheDocument();
  });
```

`MenuTriagePage.test.jsx`: mover os testes de `TriageAdminTab.test.jsx` (22–133) para a página, trocando o texto do aviso para o novo e o `window.confirm` pelo `alertdialog`; acrescentar "o aviso não usa a palavra toggle".

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/settings/automation`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
// frontend/src/pages/settings/automation/useAiTriageForm.js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { updateAiTriageConfig } from '../../../services/api';

const NOTURNO_INICIO_PADRAO = '20:00';
const NOTURNO_FIM_PADRAO = '08:00';

function fromConfig(config) {
  return {
    confidencePercent: config.triageConfidenceThreshold == null ? 80 : Math.round(config.triageConfidenceThreshold * 100),
    maxQuestions: config.triageMaxQuestions == null ? 2 : config.triageMaxQuestions,
    timeoutMinutes: config.triageTimeoutMinutes == null ? 3 : config.triageTimeoutMinutes,
    extraInstructions: config.triageExtraInstructions || '',
    resolvedReasonId: config.triageResolvedReasonId || '',
    requireBirthdate: Boolean(config.triageRequireBirthdate),
    readReceiptsDaytime: Boolean(config.triageReadReceiptsDaytime),
    nightStart: config.nightStartTime || NOTURNO_INICIO_PADRAO,
    nightEnd: config.nightEndTime || NOTURNO_FIM_PADRAO,
  };
}

// Três páginas editam pedaços diferentes da MESMA configuração, e o backend
// trata campo ausente como "desligado". Por isso save() manda os nove sempre.
export function useAiTriageForm() {
  const { token } = useAuth();
  const { config, status, loading, refresh } = useAiConfig();
  const [values, setValues] = useState(() => fromConfig(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setValues(fromConfig(config)); }, [config]);

  const setValue = useCallback((key, value) => setValues((prev) => ({ ...prev, [key]: value })), []);

  async function save() {
    setError(null);
    if (Boolean(values.nightStart) !== Boolean(values.nightEnd)) {
      setError('Informe início e fim do atendimento noturno, ou deixe os dois vazios');
      return false;
    }
    setSaving(true);
    try {
      await updateAiTriageConfig(
        {
          triageConfidenceThreshold: Number(values.confidencePercent) / 100,
          triageMaxQuestions: Number(values.maxQuestions),
          triageTimeoutMinutes: Number(values.timeoutMinutes),
          triageExtraInstructions: values.extraInstructions,
          triageResolvedReasonId: values.resolvedReasonId || null,
          nightStartTime: values.nightStart || null,
          nightEndTime: values.nightEnd || null,
          triageRequireBirthdate: values.requireBirthdate,
          triageReadReceiptsDaytime: values.readReceiptsDaytime,
        },
        token
      );
      refresh();
      return true;
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { status: status || (loading ? 'loading' : 'ready'), config, values, setValue, save, saving, error, refresh };
}
```

```jsx
// frontend/src/pages/settings/automation/NightModePage.jsx
import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card, Field, Button, AsyncState, HelpText, inputClass } from '../../../components/ui';
import { useAiTriageForm } from './useAiTriageForm';
import { useChannels } from '../../../hooks/useChannels';

function NightModePage() {
  const form = useAiTriageForm();
  const { channels, status: channelsStatus } = useChannels(true);
  const noturnos = channels.filter((c) => c.aiNightModeEnabled);

  return (
    <SettingsPage title="Atendimento noturno" description="A janela em que a IA atende sozinha à noite, nos canais que tiverem o noturno ligado." scope="global">
      <Card title="Não confundir com o horário de atendimento" tone="default">
        <p className="text-[13.5px] text-wa-text">
          <Link to="/configuracoes/regras/horario" className="text-wa-link underline">Horário de atendimento</Link> define quando há atendente humano.
          Esta janela define quando a IA atende sozinha à noite. Com o noturno ativo, o aviso de "fora do horário" não é enviado.
        </p>
      </Card>
      <AsyncState status={form.status} skeletonLines={4}>
        <form onSubmit={(e) => { e.preventDefault(); form.save(); }}>
          <Card title="Janela noturna" scope="global" footer={<Button type="submit" loading={form.saving}>Salvar janela noturna</Button>}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="triage-night-start" label="Início">
                <input id="triage-night-start" type="time" value={form.values.nightStart} onChange={(e) => form.setValue('nightStart', e.target.value)} className={inputClass} />
              </Field>
              <Field id="triage-night-end" label="Fim">
                <input id="triage-night-end" type="time" value={form.values.nightEnd} onChange={(e) => form.setValue('nightEnd', e.target.value)} className={inputClass} />
              </Field>
            </div>
            <HelpText>Todos os dias, feriados incluídos. Ex.: 20:00 a 08:00. Salve a janela antes de ligar o interruptor "Atendimento noturno" no canal: sem ela o canal recusa ligar.</HelpText>
            {form.error && <p role="alert" className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{form.error}</p>}
          </Card>
        </form>
      </AsyncState>
      <Card title="Canais com noturno ligado" scope="channel">
        <AsyncState status={channelsStatus} isEmpty={noturnos.length === 0} emptyMessage="Nenhum canal com o noturno ligado. Ligue no detalhe do canal, aba Atendimento.">
          <ul className="space-y-1 text-[14px]">
            {noturnos.map((c) => <li key={c.id}><Link to={`/configuracoes/canais/${c.id}/atendimento`} className="text-wa-link hover:underline">{c.name}</Link></li>)}
          </ul>
        </AsyncState>
      </Card>
    </SettingsPage>
  );
}

export default NightModePage;
```

`IdentificationPage.jsx`: mesmo esqueleto, com dois `Toggle` (`id="triage-require-birthdate"`, `id="triage-read-receipts-daytime"`, rótulos e descrições literais do cartão atual) e `Button` "Salvar identificação"; `HelpText` com o link para `/configuracoes/empresa`.

`AiTriagePage.jsx`: `Card title="Situação"` (OpenAI via `computeStatus({ mode: config.mode, configured: config.configured, hasError: false })` exportada de `OpenAiConfigCard.jsx`; canais com `aiEnabled`), depois o formulário com os três numéricos em grid, o select do motivo (`useReasons`) com o aviso de motivo inexistente (`form.values.resolvedReasonId && !reasons.some(r => r.id === form.values.resolvedReasonId) && reasonsStatus === 'ready'`), o textarea de instruções, e `Button` "Salvar triagem com IA". IDs dos campos iguais aos do cartão atual (`triage-confidence`, `triage-max-questions`, `triage-timeout`, `triage-resolved-reason`, `triage-extra-instructions`) para os testes migrados continuarem válidos.

`AiToolsPage.jsx`: reescreve o corpo de `AiToolPermissionsCard` na página (o componente antigo pode ser apagado junto com o teste, cujos 2 casos migram para `AiToolsPage.test.jsx`):

```jsx
{groups.map((group) => (
  <Card key={group.categoria} title={CATEGORY_LABELS[group.categoria]} tone={group.categoria === 'ACAO_SENSIVEL' ? 'warn' : 'default'}>
    {group.items.map((tool) => (
      <div key={tool.nome}>
        <Toggle id={`tool-${tool.nome}`} checked={tool.enabled} onChange={(e) => handleToggle(tool.nome, e.target.checked)} label={toolLabel(tool.nome)} description={tool.descricao} />
        <code className="ml-7 block text-[11.5px] text-wa-faint">{tool.nome}</code>
      </div>
    ))}
  </Card>
))}
```

`MenuTriagePage.jsx`: `SettingsPage title="Triagem por menu" ... action={<Button onClick={() => setCreating(true)}>Criar opção</Button>}` com `<TriageAdminTab creating onCreatingChange />`. Em `TriageAdminTab.jsx`, o aviso vira "Nenhuma opção cadastrada: a triagem por menu não roda em nenhum canal, mesmo com o interruptor ligado." e a exclusão usa `useConfirm`.

`TranscriptionPage.jsx`: `SettingsPage title="Transcrição de áudio" scope="global" scopeDetail` + `AudioTranscriptionConfigCard` (botão "Salvar transcrição"; "Buscar modelos" `disabled={!config.configured}` com `title`).

`App.jsx`: as seis rotas `automacao/…`. Apagar `AiTriageConfigCard.jsx` (+ test) e `AiToolPermissionsCard.jsx` (+ test).

- [ ] **Step 4: Rodar**

Run: `cd frontend && npx vitest run src/pages/settings/automation src/components/TriageAdminTab.test.jsx src/components/AudioTranscriptionConfigCard.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/pages/settings/automation frontend/src/components/AiTriageConfigCard.jsx frontend/src/components/AiTriageConfigCard.test.jsx frontend/src/components/AiToolPermissionsCard.jsx frontend/src/components/AiToolPermissionsCard.test.jsx frontend/src/components/TriageAdminTab.jsx frontend/src/components/TriageAdminTab.test.jsx frontend/src/components/AudioTranscriptionConfigCard.jsx frontend/src/components/OpenAiConfigCard.jsx frontend/src/pages/AdminChannelsPage.jsx frontend/src/App.jsx
git commit -m "Add the Automação e IA pages, splitting the AI triage card while keeping its nine-field payload

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Canais WhatsApp — lista e detalhe; fim de `AdminChannelsPage` e `NavRail`

**Files:**
- Create: `frontend/src/pages/settings/channels/useChannelActions.js`, `ChannelsListPage.jsx`, `ChannelDetailPage.jsx`, `ChannelConnectionTab.jsx`, `ChannelBehaviorTab.jsx`, `channelSummary.js`
- Delete: `frontend/src/pages/AdminChannelsPage.jsx` + test, `frontend/src/components/NavRail.jsx` + test
- Modify: `frontend/src/App.jsx`, `frontend/src/components/ChannelStatusBanner.jsx` (link → `/configuracoes/canais`), `frontend/src/components/SgpLookupPanel.jsx`/outros que importem `NavRail` (grep antes)
- Test: `useChannelActions.test.jsx`, `ChannelsListPage.test.jsx`, `ChannelDetailPage.test.jsx`

**Interfaces:**
- `useChannelActions(refresh)` → `{ errors: { triage, ai, aiTriage, aiNightMode, wabaId, action }, busyChannelId, toggleTriage(id, on), toggleAi(id, on), toggleAiTriage(id, on), toggleAiNightMode(id, on), saveWabaId(id, value), reconnect(channel), toggleHidden(channel), remove(channel) }`. Corpo = handlers de `AdminChannelsPage.jsx:203-303` **sem alteração de lógica** (inclusive a segunda chamada `setChannelTriageEnabled(channelId, false)` ao ligar a IA, com `refresh()` no `finally`). Os `window.confirm` viram `useConfirm` com os mesmos textos; o hook devolve também `confirmDialog`.
- `channelSummary(channel, { triageOptionsCount, nightWindowSet, openAiReady })` → `{ chips: ['Triagem por menu', 'IA', 'Triagem IA', 'Noturno'] (só os ligados), warnings: [strings] }`. Avisos: menu ligado sem opções → "Triagem por menu ligada sem opções cadastradas"; `aiEnabled && !openAiReady` → "IA ligada sem OpenAI configurada"; `aiNightModeEnabled && !nightWindowSet` → "Noturno ligado sem janela definida".
- `ChannelsListPage`: `SettingsPage title="Canais" description="Os números de WhatsApp ligados ao atendimento." scope="channel" action={canManage && <Button>Criar canal</Button>} wide`; barra com `Toggle` "Mostrar canais ocultos" (`?ocultos=1`); um cartão por canal (`<Link to={`/configuracoes/canais/${id}/conexao`}>`) com nome, `channelTypeLabel`, número, `StatusDot` (o de `AdminChannelsPage.jsx:70-88`, movido para `ChannelConnectionTab.jsx` e exportado), chips e avisos. `canManage = hasLevel(agent, 'integrations')`.
- `ChannelDetailPage`: carrega o canal de `useChannels(true, true)` por `:id`; `PageHeader` com `crumbs` (Configurações › Canais WhatsApp), título = nome, descrição = provedor · número; `Tabs` por rota (`conexao`, `atendimento`); `<Outlet context={{ channel, refresh, actions, canManage }}>`; canal não encontrado → "Canal não encontrado" + link para a lista.
- `ChannelConnectionTab`: `StatusDot`; `QrCodeView` (Baileys `awaiting_qr`, polling de 5 s como hoje); campo WABA ID + "Salvar WABA ID" (oficiais); `DangerZone` com Reconectar (Baileys), Ocultar/Reexibir, Excluir. Sem `canManage`: controles desabilitados com `title="Requer permissão de Canais e Integrações"` e uma linha de aviso no topo.
- `ChannelBehaviorTab`: quatro `Toggle` com `disabledReason`: "Triagem com IA" → `!aiEnabled` ? "Precisa de Atendimento com IA ligado" ; "Atendimento noturno" → `!aiTriageEnabled` ? "Precisa de Triagem com IA ligada" : `!nightWindowSet` ? "Defina a janela em Automação e IA › Atendimento noturno" (link). Descrição do interruptor "Atendimento com IA": "Ligar a IA desliga a triagem por menu neste canal: só um robô responde por vez." Abaixo, `Card title="Configurações globais que valem para este canal"` com linhas: Triagem por menu (`N opções` ou "sem opções", link), Boas-vindas (texto ou "não definida", link), Horário de atendimento (`HH:MM–HH:MM` ou "não configurado", link), Janela noturna (ou "não definida", link), OpenAI (situação, link).

- [ ] **Step 1: Testes**

`useChannelActions.test.jsx`: migrar os testes 238–520 de `AdminChannelsPage.test.jsx` que exercitam os handlers (toggle triage/AI/AI triage/noturno com erros e a segunda chamada), agora via `renderHook(() => useChannelActions(refresh))` + `act(() => result.current.toggleAi('ch1', true))`, asserindo as mesmas chamadas de `setChannelAiEnabled`/`setChannelTriageEnabled` na mesma ordem e `refresh` chamado no `finally`.

```jsx
// frontend/src/pages/settings/channels/ChannelsListPage.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChannelsListPage from './ChannelsListPage';
import { renderInShell } from '../../../test-utils/renderInShell';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../services/api');

const baileys = { id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', status: 'connected', triageEnabled: true, aiEnabled: false };
const oficial = { id: 'ch2', type: 'meta_cloud', name: 'Suporte', phoneNumber: '+5511900000000', status: 'connected', aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  useTriage.mockReturnValue({ config: {}, options: [], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: false, mode: 'disabled', nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
});

describe('ChannelsListPage', () => {
  test('lista canais com provedor, número, situação e resumo das automações', () => {
    useChannels.mockReturnValue({ channels: [baileys, oficial], status: 'ready', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    expect(screen.getByRole('link', { name: /berg/i })).toHaveAttribute('href', '/configuracoes/canais/ch1/conexao');
    expect(screen.getByText('Oficial · API')).toBeInTheDocument();
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('Triagem por menu ligada sem opções cadastradas')).toBeInTheDocument();
    expect(screen.getByText('IA ligada sem OpenAI configurada')).toBeInTheDocument();
    expect(screen.getByText('Noturno ligado sem janela definida')).toBeInTheDocument();
  });

  test('gerente sem a flag vê a lista mas não o botão Criar canal', () => {
    useAuth.mockReturnValue({ token: 'tok', agent: { role: 'manager', canManageIntegrations: false } });
    useChannels.mockReturnValue({ channels: [baileys], status: 'ready', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    expect(screen.getByText('Berg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /criar canal/i })).not.toBeInTheDocument();
  });

  test('"Mostrar canais ocultos" vai para a URL e pede os ocultos ao hook', async () => {
    useChannels.mockReturnValue({ channels: [], status: 'ready', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    await userEvent.click(screen.getByRole('checkbox', { name: /mostrar canais ocultos/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('ocultos=1');
    expect(useChannels).toHaveBeenLastCalledWith(true, true);
  });

  test('em carregamento não mostra "nenhum canal"', () => {
    useChannels.mockReturnValue({ channels: [], status: 'loading', refresh: vi.fn() });
    renderInShell(<ChannelsListPage />, { path: '/configuracoes/canais' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/nenhum canal/i)).not.toBeInTheDocument();
  });
});
```

```jsx
// frontend/src/pages/settings/channels/ChannelDetailPage.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChannelDetailPage from './ChannelDetailPage';
import ChannelConnectionTab from './ChannelConnectionTab';
import ChannelBehaviorTab from './ChannelBehaviorTab';
import { useAuth } from '../../../contexts/AuthContext';
import { useChannels } from '../../../hooks/useChannels';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useBusinessHoursConfig } from '../../../hooks/useBusinessHoursConfig';
import * as api from '../../../services/api';

vi.mock('../../../contexts/AuthContext');
vi.mock('../../../hooks/useChannels');
vi.mock('../../../hooks/useTriage');
vi.mock('../../../hooks/useAiConfig');
vi.mock('../../../hooks/useBusinessHoursConfig');
vi.mock('../../../services/api');

const refresh = vi.fn();
const berg = { id: 'ch1', type: 'baileys', name: 'Berg', phoneNumber: '+5598900000000', status: 'awaiting_qr', triageEnabled: false, aiEnabled: true, aiTriageEnabled: false, aiNightModeEnabled: false, welcomeMessage: null };

function renderDetail(path, agent = { role: 'admin' }) {
  useAuth.mockReturnValue({ token: 'tok', agent });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracoes/canais/:id" element={<ChannelDetailPage />}>
          <Route path="conexao" element={<ChannelConnectionTab />} />
          <Route path="atendimento" element={<ChannelBehaviorTab />} />
        </Route>
        <Route path="/configuracoes/canais" element={<p>lista de canais</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useChannels.mockReturnValue({ channels: [berg], status: 'ready', refresh });
  useTriage.mockReturnValue({ config: {}, options: [{ id: 'o1' }], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant', model: 'gpt', nightStartTime: null, nightEndTime: null }, status: 'ready', loading: false, refresh: vi.fn() });
  useBusinessHoursConfig.mockReturnValue({ config: { id: null, enabled: false, startTime: '08:00', endTime: '18:00', message: '' }, status: 'ready', refresh: vi.fn() });
  api.setChannelAiEnabled.mockResolvedValue({});
  api.setChannelTriageEnabled.mockResolvedValue({});
  api.deleteChannel.mockResolvedValue({});
});

describe('ChannelDetailPage', () => {
  test('aba Conexão mostra o QR de um baileys aguardando e as ações de cuidado', () => {
    renderDetail('/configuracoes/canais/ch1/conexao');
    expect(screen.getByRole('heading', { level: 1, name: 'Berg' })).toBeInTheDocument();
    expect(screen.getByTitle('QR - Berg')).toBeInTheDocument();
    const zone = screen.getByRole('heading', { name: /ações com cuidado/i }).closest('section');
    expect(within(zone).getByRole('button', { name: /reconectar/i })).toBeInTheDocument();
    expect(within(zone).getByRole('button', { name: /ocultar/i })).toBeInTheDocument();
    expect(within(zone).getByRole('button', { name: /excluir/i })).toBeInTheDocument();
  });

  test('aba Atendimento explica por que o noturno está desabilitado', () => {
    renderDetail('/configuracoes/canais/ch1/atendimento');
    const noturno = screen.getByRole('checkbox', { name: /atendimento noturno/i });
    expect(noturno).toBeDisabled();
    expect(screen.getByText('Precisa de Triagem com IA ligada')).toBeInTheDocument();
  });

  test('aba Atendimento avisa janela ausente com link para Automação › Atendimento noturno', () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, aiTriageEnabled: true }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/atendimento');
    expect(screen.getByRole('checkbox', { name: /atendimento noturno/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /defina a janela/i })).toHaveAttribute('href', '/configuracoes/automacao/noturno');
  });

  test('ligar a IA chama setChannelAiEnabled e depois setChannelTriageEnabled(false), e recarrega', async () => {
    useChannels.mockReturnValue({ channels: [{ ...berg, aiEnabled: false }], status: 'ready', refresh });
    renderDetail('/configuracoes/canais/ch1/atendimento');
    await userEvent.click(screen.getByRole('checkbox', { name: /atendimento com ia/i }));
    await waitFor(() => expect(api.setChannelTriageEnabled).toHaveBeenCalledWith('ch1', false, 'tok'));
    expect(api.setChannelAiEnabled).toHaveBeenCalledWith('ch1', true, 'tok');
    expect(api.setChannelAiEnabled.mock.invocationCallOrder[0]).toBeLessThan(api.setChannelTriageEnabled.mock.invocationCallOrder[0]);
    expect(refresh).toHaveBeenCalled();
  });

  test('excluir pede confirmação com o texto de sempre e só então chama a API', async () => {
    renderDetail('/configuracoes/canais/ch1/conexao');
    await userEvent.click(screen.getByRole('button', { name: /excluir/i }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Excluir o canal "Berg" definitivamente? Só é possível se ele nunca teve conversas.');
    expect(api.deleteChannel).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /excluir/i }));
    await waitFor(() => expect(api.deleteChannel).toHaveBeenCalledWith('ch1', 'tok'));
  });

  test('canal inexistente mostra aviso e link para a lista', () => {
    renderDetail('/configuracoes/canais/nao-existe/conexao');
    expect(screen.getByText(/canal não encontrado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voltar para a lista/i })).toHaveAttribute('href', '/configuracoes/canais');
  });

  test('gerente sem a flag vê os interruptores desabilitados com a explicação', () => {
    renderDetail('/configuracoes/canais/ch1/atendimento', { role: 'manager', canManageIntegrations: false });
    expect(screen.getByRole('checkbox', { name: /atendimento com ia/i })).toBeDisabled();
    expect(screen.getAllByText(/requer permissão de canais e integrações/i).length).toBeGreaterThan(0);
  });

  test('a aba Atendimento resume as configurações globais com atalhos', () => {
    renderDetail('/configuracoes/canais/ch1/atendimento');
    expect(screen.getByText(/1 opção/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /boas-vindas/i })).toHaveAttribute('href', '/configuracoes/mensagens/boas-vindas');
    expect(screen.getByRole('link', { name: /horário de atendimento/i })).toHaveAttribute('href', '/configuracoes/regras/horario');
    expect(screen.getByRole('link', { name: /openai/i })).toHaveAttribute('href', '/configuracoes/integracoes/openai');
  });
});
```

`useChannelActions.test.jsx`: migrar os testes 238–520 de `AdminChannelsPage.test.jsx` que exercitam os handlers (toggle triage/AI/AI triage/noturno com erros, WABA ID, e a segunda chamada ao ligar a IA), agora via `renderHook(() => useChannelActions(refresh))` + `await act(() => result.current.toggleAi('ch1', true))`, asserindo as mesmas chamadas na mesma ordem, `errors.ai` preenchido quando a API rejeita, e `refresh` chamado no `finally` mesmo com erro.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/pages/settings/channels`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```js
// frontend/src/pages/settings/channels/channelSummary.js
export function channelSummary(channel, { triageOptionsCount = 0, nightWindowSet = false, openAiReady = false } = {}) {
  const chips = [];
  const warnings = [];
  if (channel.triageEnabled) {
    chips.push('Triagem por menu');
    if (triageOptionsCount === 0) warnings.push('Triagem por menu ligada sem opções cadastradas');
  }
  if (channel.aiEnabled) {
    chips.push('IA');
    if (!openAiReady) warnings.push('IA ligada sem OpenAI configurada');
  }
  if (channel.aiTriageEnabled) chips.push('Triagem IA');
  if (channel.aiNightModeEnabled) {
    chips.push('Noturno');
    if (!nightWindowSet) warnings.push('Noturno ligado sem janela definida');
  }
  return { chips, warnings };
}
```

`useChannelActions.js`: copiar os handlers de `AdminChannelsPage.jsx:203-303` para dentro do hook (estado `errors` como objeto, `busyChannelId`), trocando `window.confirm(msg)` por `await confirm(msg, { danger: true, confirmLabel: 'Continuar' | 'Ocultar' | 'Reexibir' | 'Excluir' })`. Manter os comentários do arquivo original sobre a ordem das chamadas.

`ChannelDetailPage.jsx`:

```jsx
import { useParams, Outlet, Navigate } from 'react-router-dom';
// ...
function ChannelDetailPage() {
  const { id } = useParams();
  const { agent } = useAuth();
  const canManage = hasLevel(agent, 'integrations');
  const { channels, status, error, refresh } = useChannels(true, true);
  const actions = useChannelActions(refresh);
  const channel = channels.find((c) => c.id === id);
  // polling do QR igual ao antigo
  useEffect(() => {
    if (!channel || channel.status !== 'awaiting_qr') return undefined;
    const interval = setInterval(() => refresh(), 5000);
    return () => clearInterval(interval);
  }, [channel?.status, refresh]);

  return (
    <ProtectedRoute level="admin" areaLabel="Canais">
      <div className="flex min-h-0 flex-1 flex-col">
        <AsyncState status={status} error={error} onRetry={refresh}>
          {!channel ? (
            <div className="px-6 py-10 text-center text-[14px] text-wa-muted">Canal não encontrado. <Link to="/configuracoes/canais" className="text-wa-link underline">Voltar para a lista</Link></div>
          ) : (
            <>
              <div className="border-b border-white/[0.06] px-4">
                <PageHeader crumbs={[{ label: 'Configurações', to: '/configuracoes' }, { label: 'Canais WhatsApp', to: '/configuracoes/canais' }]} title={channel.name} description={`${channelTypeLabel(channel.type)} · ${channel.phoneNumber}`} action={<ScopeBadge scope="channel" />} />
                <div className="pb-4"><Tabs tabs={[{ key: 'conexao', label: 'Conexão', to: `/configuracoes/canais/${id}/conexao` }, { key: 'atendimento', label: 'Atendimento', to: `/configuracoes/canais/${id}/atendimento` }]} /></div>
              </div>
              <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6"><div className="max-w-3xl space-y-6"><Outlet context={{ channel, refresh, actions, canManage }} /></div></div>
              {actions.confirmDialog}
            </>
          )}
        </AsyncState>
      </div>
    </ProtectedRoute>
  );
}
```

`App.jsx`:

```jsx
<Route path="canais" element={<ChannelsListPage />} />
<Route path="canais/:id" element={<ChannelDetailPage />}>
  <Route index element={<Navigate to="conexao" replace />} />
  <Route path="conexao" element={<ChannelConnectionTab />} />
  <Route path="atendimento" element={<ChannelBehaviorTab />} />
</Route>
```

Remover a rota provisória `path="*"` de Configurações e os imports de `AdminChannelsPage`. Apagar `AdminChannelsPage.jsx`/`.test.jsx`, `NavRail.jsx`/`.test.jsx` (mover o teste de `iniciaisDaEmpresa` para `SideNav.test.jsx`). `ChannelStatusBanner.jsx`: `to="/configuracoes/canais"` e texto "ver em Configurações › Canais"; ajustar `ChannelStatusBanner.test.jsx`. `grep -rn "NavRail\|/admin/channels\|/admin/dashboard\|/metrics\b\|/campaigns" frontend/src --include=*.jsx --include=*.js` e trocar cada uso restante pelo caminho novo (menos `navItems.js` e os testes de redirecionamento).

- [ ] **Step 4: Rodar a suíte inteira**

Run: `cd frontend && npx vitest run`
Expected: PASS em todos os arquivos.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "Add the channel list and detail pages and retire AdminChannelsPage and NavRail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: `status` nos hooks e `AsyncState` nos consumidores

**Files:**
- Modify (hooks): `useChannels`, `useAgents`, `useAgentsAdmin`, `useSectors`, `useCities`, `useCityNotices`, `useQuickReplies`, `useReasons`, `useReasonsAdmin`, `useTemplates`, `useSgpIntegrations`, `useSgpQueryConfig`, `useAiConfig`, `useAiTools`, `useCompanyConfig`, `useCompanyName`, `useAssignmentMessageConfig`, `useBusinessHoursConfig`, `useTriage`, `useQueue`, `useMyConversations`, `useMyClosedConversations`, `useAttendanceDashboard`
- Modify (consumidores do anexo 4 do inventário): `TeamPanel`, `TransferModal`, `SupervisionPage` (filtros e colunas), `EditContactModal`, `MessageInput` (popover), `CloseReasonModal`, `ConversationHistoryModal`, `ClosedConversationsList`, `QueueList`/`MyConversationsList` (via `DashboardPage`), `CompanyConfigCard`, `SgpQueryConfigCard`, `OpenAiConfigCard`, `AudioTranscriptionConfigCard`, `AssignmentMessageSection`, `BusinessHoursSection`, `TriageConfigForm`/`TriageAdminTab`, `TemplatesAdminTab`, `LoginPage`/`SideNav`/`ConversationView` (nome da empresa)
- Test: cada `hooks/*.test.jsx` existente ganha um caso de `status`; consumidores ganham um caso "em loading não mostra vazio".

**Interfaces:**
- Todo hook de lista passa a ser `const { data, status, error, refresh } = useAsyncResource(() => listX(token), [token], { initial: [], enabled })` e devolve `{ <nomeAntigo>: data, status, error, loading: status === 'loading', refresh }`. Hooks com socket (`useQueue`, `useMyConversations`, `useAttendanceDashboard`) mantêm o `useState` próprio para os `setX` dos eventos, mas o GET inicial passa por `useAsyncResource` com `setData` sincronizado: mais simples, adicionam `const [status, setStatus] = useState('loading')` e setam `'ready'`/`'error'`/`'forbidden'` no `.then/.catch` do GET inicial, devolvendo `{ ...antigo, status }`. `useQueue` e `useMyConversations` passam a devolver **objeto** `{ queue, status }` / `{ conversations, status }` — atualizar `DashboardPage` (e testes) que hoje recebem o array direto.
- `useCompanyName` → `{ name, status }`.

- [ ] **Step 1: Testes** — para cada hook, um caso no estilo:

```jsx
  test('expõe status loading → ready', async () => {
    api.listSectors.mockResolvedValue([]);
    const { result } = renderHook(() => useSectors());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
  test('403 vira forbidden', async () => {
    api.listSectors.mockRejectedValue({ status: 403, body: { error: 'Insufficient permissions' } });
    const { result } = renderHook(() => useSectors());
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });
```

Para consumidores, um caso por componente:

```jsx
  test('em carregamento não mostra "Nenhum atendente"', () => {
    useAgents.mockReturnValue({ agents: [], status: 'loading' });
    render(<TeamPanel />);
    expect(screen.queryByText(/nenhum atendente/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
```

(`useAgents` passa a devolver `{ agents, status }` em vez do array — atualizar `TeamPanel`, `TransferModal`, `SupervisionPage` e seus testes.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd frontend && npx vitest run src/hooks`
Expected: FAIL nos casos novos.

- [ ] **Step 3: Implementar** — exemplo completo de um hook de lista:

```js
// frontend/src/hooks/useSectors.js
import { useAuth } from '../contexts/AuthContext';
import { listSectors } from '../services/api';
import { useAsyncResource } from './useAsyncResource';

export function useSectors() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => listSectors(token), [token], { initial: [], enabled: Boolean(token) });
  return { sectors: data, status, error, loading: status === 'loading', refresh };
}
```

Exemplo de hook de config:

```js
// frontend/src/hooks/useAiConfig.js
const EMPTY = { configured: false, mode: 'disabled', model: '' };
export function useAiConfig() {
  const { token } = useAuth();
  const { data, status, error, refresh } = useAsyncResource(() => getAiConfig(token), [token], { initial: EMPTY, enabled: Boolean(token) });
  return { config: data, status, error, loading: status === 'loading', refresh };
}
```

Consumidores: envolver a lista/formulário em `<AsyncState status={status} error={error} onRetry={refresh} isEmpty={items.length === 0} emptyMessage="...">`. Formulários de config (`CompanyConfigCard`, `SgpQueryConfigCard`, `OpenAiConfigCard`, `AudioTranscriptionConfigCard`, `AssignmentMessageSection`, `BusinessHoursSection`, `TriageConfigForm`) só renderizam os campos com `status === 'ready'`; antes disso, `AsyncState` com esqueleto. `OpenAiConfigCard`: o selo de situação só aparece com `ready`. `useCompanyName` em `loading`: `SideNav` mostra só o ícone; `LoginPage`/`DashboardPage`/`ConversationView` deixam o nome vazio (sem "Atendimento" genérico) até `ready`.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "Give every data hook a status and render loading, empty, error and forbidden states distinctly

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Nomenclatura e textos de vazio

**Files:**
- Modify: `frontend/src/components/ConversationInfoPanel.jsx` ("Na automação" → "Em automação"), `frontend/src/components/ClosedConversationsModal.jsx` (título "Encerrados"), `frontend/src/components/ConversationListItem.jsx` (sem mudança de texto; só conferir), `frontend/src/components/CreateAgentForm.jsx` ("Cadastrar novo usuário"; a opção de tipo continua "Atendente"), qualquer resto encontrado pelo grep.
- Test: ajustar os testes que citam os textos antigos.

- [ ] **Step 1: Grep de conferência**

```bash
cd frontend/src && grep -rn "toggle\b\|Departamento\|Na automação\|triagem automática\|Dashboard de atendimento\|Administração\|Atendimentos encerrados\|Relatório\b" --include=*.jsx . | grep -v test | grep -v "^./components/icons"
```

Expected após a task: nenhuma ocorrência voltada ao usuário (comentários e nomes de função podem ficar).

- [ ] **Step 2: Aplicar**

- `ConversationInfoPanel.jsx:22`: `label: 'Em automação'`.
- `ClosedConversationsModal.jsx:13`: `title="Encerrados"`; o botão do menu continua "Atendimentos encerrados" (é o nome da ação), o título do modal fica "Encerrados".
- `CreateAgentForm.jsx`: título "Cadastrar novo usuário"; rótulo do select "Tipo" com opções "Atendente / Gerente / Administrador" (inalteradas).
- `ReasonsAdminTab` ajuda: "…aparece agrupado em Relatórios, em 'Motivos de contato'."
- `MessageInput.jsx` popover vazio: "Nenhuma resposta rápida cadastrada."

- [ ] **Step 3: Rodar a suíte**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "Align user-facing names: Setores, Usuários, Em automação, interruptor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: Passe de design, verificação visual em três larguras e acessibilidade

**Files:**
- Modify: `frontend/src/index.css` (tokens novos se necessário; nunca cor literal nos componentes), `components/ui/*`, páginas de Configurações/Supervisão/Relatórios.
- Create (descartáveis, não commitados): `frontend/preview-*.html` + `frontend/src/preview-*.jsx` conforme a receita da memória `project_visual_check_headless_preview`.
- Output: `output/reorganizacao/<pagina>-<largura>.png` (commitados como evidência).

- [ ] **Step 1: Invocar o skill `frontend-design:frontend-design`** com este brief: "Refinar, sem mudar estrutura nem textos, as telas densas de um app de atendimento WhatsApp (tema escuro vidro fumê, cobre e laranja `#f4531f`, tipografia Sora/Inter). Alvos: `SettingsLayout` + `SettingsPage`, `SupervisionPage`, `ReportsPage`, `ChannelsListPage`, `ChannelDetailPage`. Hierarquia: título de página 26px/600 > título de cartão 16px/600 > rótulo 13px/500. Largura máxima de formulário 720px. Brilhos de fundo a 40% do chat. Ícones nos itens do menu de Configurações (um por grupo, de `WaIcons`). Não introduzir cores literais: só tokens `chat-*`/`wa-*`."

- [ ] **Step 2: Acessibilidade (checklist manual, anotar em `output/reorganizacao/a11y.md`)**
  - Tab percorre `SideNav` → conteúdo → rodapé; item ativo tem `aria-current`.
  - Abas de `Tabs` respondem a ← →.
  - `ConfirmDialog`: foco entra no Cancelar, Esc fecha, foco volta ao botão de origem (testado na Task 4; conferir no browser).
  - Todo `Toggle` desabilitado tem texto de motivo.
  - Situação do canal: ponto colorido + texto.
  - Contraste: `chat-muted` (#c7c2bd) sobre `#100e0d` ≥ 4.5:1; `wa-muted` escuro (#b6b0ab) sobre painéis ≥ 4.5:1. Se algum rótulo `chat-faint` (#8b8682) for texto essencial, promover a `chat-muted`.

- [ ] **Step 3: Prints headless em 520, 820 e 1440 px** para: Atendimento (lista e conversa aberta), Supervisão (todos e encerrados), Relatórios (admin), Campanhas (lista, modal em revisão), Configurações › Canais (lista), Canal › Conexão, Canal › Atendimento, Automação › IA, Mensagens › Boas-vindas, Equipe › Perfis, Acesso negado, menu compacto, painel do menu no celular. Comando por print:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1440,900 --screenshot="D:\dw-whatsapp-backend\output\reorganizacao\canais-1440.png" --virtual-time-budget=6000 "http://localhost:5199/preview-canais.html"
```

(520 é a menor largura real do headless no Windows; ver memória.) Conferir cada PNG e corrigir estouros (`min-w-0`, `overflow-x-auto` só em tabela).

- [ ] **Step 4: Apagar os previews, rodar a suíte, commit**

```bash
rm frontend/preview-*.html frontend/src/preview-*.jsx
cd frontend && npx vitest run && cd ..
git add -A frontend/src output/reorganizacao
git commit -m "Refine the dense screens' visual hierarchy and record the three-width visual check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 21: Revisão final contra o inventário e entregas

**Files:**
- Create: `docs/superpowers/specs/2026-09-15-reorganizacao-entrega.md`
- Modify: `docs/superpowers/specs/2026-09-15-inventario-funcional.md` (coluna "Destino" e "Como verificar" preenchidas)

- [ ] **Step 1: Contrato de gravação — conferir um a um**

Para cada linha do Anexo 2 do inventário, localizar o teste que afirma o payload (grep pelo nome da função de `api.js` nos `*.test.jsx`) e anotar `arquivo:linha` na coluna "Como verificar". Se faltar teste para algum formulário, escrever nesta task (padrão: preencher campos, clicar Salvar, `expect(api.fn).toHaveBeenCalledWith({...payload exato...}, 'tok')`).

- [ ] **Step 2: Grep de segurança de permissões** (memória do projeto: `requireRole` não é a única superfície)

```bash
grep -rn "role === 'admin'\|role !== 'admin'\|canManageIntegrations" frontend/src --include=*.jsx --include=*.js | grep -v test | grep -v navItems
```

Expected: nenhuma checagem de papel fora de `hasLevel` (exceto o `role === 'agent'` do botão de encerrados no `SideNav` e o `isMine/isAdmin` da conversa, que já são regras de posse, não de página).

- [ ] **Step 3: Grep de rotas antigas em código de produção**

```bash
grep -rn "'/admin/\|'/metrics'\|'/campaigns" frontend/src --include=*.jsx --include=*.js | grep -v test | grep -v navItems.js
```

Expected: vazio.

- [ ] **Step 4: Suítes completas**

Run: `cd frontend && npx vitest run && cd .. && npm test`
Expected: PASS nas duas.

- [ ] **Step 5: Escrever a entrega** em `docs/superpowers/specs/2026-09-15-reorganizacao-entrega.md`, com as seções: 1) inventário (link), 2) mapa da navegação (copiar da spec 3.1/3.2), 3) tabela antiga → nova (spec 4), 4) implementação (lista de commits `git log --oneline main..reorganizacao-interface`), 5) testes e evidências (contagem de testes por suíte + lista dos PNGs + `a11y.md`), 6) limitações e pendências (spec 12, mais o que surgiu), 7) reversão (spec 13).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs
git commit -m "Record the reorganization delivery: inventory verification, evidence and rollback notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Depois desta task, seguir `superpowers:finishing-a-development-branch`. **Não** fazer deploy.
