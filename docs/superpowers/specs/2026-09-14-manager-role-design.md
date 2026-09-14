# Papel "Gerente" (admin com menos poderes)

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-14

## 1. Problema e objetivo

Hoje só existem dois papéis (`agents.role`, `CHECK (role IN ('agent', 'admin'))` —
migração `1788610139386`): atendente e admin. O usuário precisa delegar a criação de
acessos de novos colaboradores e o reset de senha de atendentes travados, sem entregar
o controle total do sistema — em especial sem abrir mão do controle sobre credenciais
sensíveis (canais do WhatsApp, integração com o SGP, chave da OpenAI).

Pedido, nas palavras do usuário: um acesso de "gerente" que possa criar contas de
atendente, cadastrar conteúdo administrativo (cidades, mensagens, etc.) e resetar senha
de atendente — "um admin com menos poderes" — com uma permissão configurável, marcada no
momento da criação daquele gerente, para liberar ou não o acesso a Integrações.

Decisões confirmadas pelo usuário durante o brainstorming:

1. Gerente só cria/gerencia contas de **atendente** — nunca outro gerente ou admin.
2. Gerente enxerga a **Dashboard de Atendimento** (todas as conversas, busca por
   protocolo/telefone, transferir/finalizar qualquer atendimento) — mesma visão que o
   admin já tem hoje.
3. **Canais** (criar/editar/excluir canal do WhatsApp, reconectar, ver QR code) entra na
   **mesma permissão configurável** de Integrações — só ver a lista de canais (nome e
   status, sem credencial) fica sempre liberado, porque outras telas (Dashboard de
   Atendimento, aviso de canal desconectado) dependem dessa leitura mesmo para um
   gerente sem a permissão.
4. A configuração de **IA** (transcrição de áudio, modo noturno) guarda uma chave da
   OpenAI — mesma categoria de credencial sensível. **Configurar/trocar a chave e testar
   a conexão** entram na mesma permissão; os ajustes sem credencial (janela do modo
   noturno, quais ferramentas a IA pode usar, configuração de transcrição) ficam sempre
   liberados, mesma lógica da Triagem.
5. Permissão só se define **na criação** do gerente — não existe tela de "editar depois"
   (mesma regra que já vale hoje para o papel `admin`/`agent`, que também é fixado na
   criação).

## 2. Abordagem técnica

`requireRole(role)` (`src/auth/auth.middleware.js:17-24`) hoje faz comparação exata de
string, e `requireRole('admin')` aparece em 55 lugares (14 arquivos
`admin-*.routes.js`). Reescrever cada um deles um por um para aceitar dois papéis seria
uma mudança grande e repetitiva sem necessidade.

Em vez disso, `manager` passa a ser tratado como **admin por herança**: a própria
`requireRole('admin')` passa a aceitar `role === 'manager'` também. Isso libera
automaticamente, sem tocar uma linha nessas rotas, as 11 áreas administrativas sem
credencial sensível: Atendentes, Setores, Mensagens (respostas rápidas, boas-vindas,
auto-resposta por horário), Motivos, Cidades (+ avisos por cidade), Triagem (bot de
menu), Dashboard de Atendimento, Relatório/Métricas, Campanhas, e a maior parte da IA
(transcrição, thresholds de triagem, ferramentas).

Só onde o gerente precisa ser **mais restrito** que um admin entra tratamento explícito:

- **Canais + Integrações + credencial da IA** — middleware novo,
  `requireIntegrationsAccess`, que só o admin sempre passa; o gerente passa apenas se
  `can_manage_integrations = true`.
- **Criar/gerenciar outro atendente** — regra dentro da própria rota de agentes: o corpo
  da requisição só pode pedir `role: 'agent'` quando quem está chamando é gerente, e as
  ações sobre uma conta já existente (ativar/desativar, resetar senha, editar setores)
  só valem quando a conta alvo já é `role = 'agent'`.

Abordagens descartadas: um sistema de permissões genérico (flags individuais por
capacidade) é over-engineering para uma única exceção citada pelo usuário (YAGNI); listar
`['admin', 'manager']` rota por rota nas 14 rotas obrigaria editar todas sem necessidade,
quando só duas categorias (credencial sensível; gerenciar outra conta admin-level)
precisam de tratamento especial.

## 3. Modelo de dados

```sql
ALTER TABLE agents DROP CONSTRAINT agents_role_check;
ALTER TABLE agents ADD CONSTRAINT agents_role_check CHECK (role IN ('agent', 'admin', 'manager'));
ALTER TABLE agents ADD COLUMN can_manage_integrations BOOLEAN NOT NULL DEFAULT false;
```

`can_manage_integrations` só tem efeito quando `role = 'manager'` — o backend força
`false` para qualquer outro papel na criação (seção 5), então não existe um estado
"admin sem permissão de integrações" para confundir a lógica de autorização.

O projeto enumera colunas em cada `SELECT`/`RETURNING` em vez de `SELECT *`
([[project_columns_enumerated_not_star]]) — toda consulta em `agent.repository.js` que
hoje lista `role` precisa ganhar `can_manage_integrations` também: `createAgent`,
`findAgentByEmail`, `findAgentById`, `listAgents`, `setAgentActive`,
`updateAgentProfile`. `findAgentByIdWithPasswordHash` não precisa (usada só para
verificar senha no login por atendente, nunca lida com papel).

## 4. Backend — middleware

**`src/auth/auth.middleware.js`:**

```js
const ADMIN_LEVEL_ROLES = ['admin', 'manager'];

function requireRole(role) {
  return (req, res, next) => {
    const allowed = role === 'admin' ? ADMIN_LEVEL_ROLES : [role];
    if (!allowed.includes(req.agent?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function hasIntegrationsAccess(agent) {
  return agent?.role === 'admin' || (agent?.role === 'manager' && agent?.canManageIntegrations === true);
}

function requireIntegrationsAccess(req, res, next) {
  if (!hasIntegrationsAccess(req.agent)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess };
```

`hasIntegrationsAccess` é exportada à parte porque `admin-channels.routes.js` tem uma
rota (`GET /:id/qr`, QR code exibido como `<img src>`) que já usa uma função de
autenticação própria (`authenticateQrRoute`, lê o token da query string em vez do header
`Authorization`) — ela passa a chamar `hasIntegrationsAccess(req.agent)` em vez do
`req.agent.role !== 'admin'` atual, em vez de duplicar a regra.

`req.agent.canManageIntegrations` só existe se estiver no próprio token — ver seção 6.

## 5. Backend — rotas de agentes (`src/api/admin-agents.routes.js`)

- `VALID_ROLES = ['agent', 'admin', 'manager']`.
- `POST /` (criar atendente/gerente/admin): passa a aceitar `canManageIntegrations` no
  corpo (boolean, default `false`), só gravado quando `role === 'manager'` (forçado
  `false` para qualquer outro papel, mesmo se o corpo mandar `true`). Quando quem chama
  é `role === 'manager'`, o `role` pedido no corpo só pode ser `'agent'` — qualquer outro
  valor retorna 403 `{ error: 'Managers can only create attendant accounts' }` (a
  validação de formato do `role` já existente continua antes dessa checagem).
- `PATCH /:id` (ativar/desativar), `PUT /:id/password` (resetar senha),
  `PUT /:id/sectors` (setores): as três buscam a conta alvo com `findAgentById` (a de
  senha já faz isso hoje; as outras duas ganham a busca). Quando quem chama é
  `role === 'manager'` e a conta alvo não é `role === 'agent'`, retorna 403
  `{ error: 'Managers can only manage attendant accounts' }` antes de aplicar a ação.
- `GET /` (listar): sem mudança — gerente continua vendo a lista inteira, inclusive
  contas admin/gerente, só não pode agir sobre elas. Transparência sem abrir brecha de
  escalonamento.
- Nenhuma rota deste arquivo troca `requireRole('admin')` por `requireIntegrationsAccess`
  — a herança da seção 4 já libera `manager` para todas elas automaticamente, e
  criar/gerenciar atendente nunca foi listado como sensível. As checagens novas desta
  seção (papel pedido, conta alvo) vivem dentro do corpo de cada rota, não no middleware.

## 6. Backend — login e token (`src/auth/auth.service.js`)

```js
const token = jwt.sign(
  { agentId: agent.id, role: agent.role, canManageIntegrations: agent.canManageIntegrations || false },
  process.env.JWT_SECRET,
  { expiresIn: TOKEN_EXPIRY }
);
return {
  token,
  agent: {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    canManageIntegrations: agent.canManageIntegrations || false,
    avatarPath: agent.avatarPath || null,
  },
};
```

Mesmo padrão que `role` já segue hoje: a permissão vem "carimbada" no token no momento
do login, não é reconsultada no banco a cada requisição. Se um admin mudar a permissão
de um gerente depois, só vale a partir do próximo login dele — mesma característica que
já existe para mudança de papel (não existe "forçar logout" no projeto hoje), não é uma
limitação nova.

## 7. Backend — Canais (`src/api/admin-channels.routes.js`)

Troca `requireRole('admin')` por `requireIntegrationsAccess` em `POST /` (criar),
`PATCH /:id` (editar — cobre triageEnabled, wabaId, hidden, welcomeMessage, aiEnabled,
aiTriageEnabled, aiNightModeEnabled: é uma rota só para todo campo editável do canal,
sem separar por campo), `POST /:id/reconnect` e `DELETE /:id`.

`GET /` (listar) **fica como `requireRole('admin')`** (aberto por herança, sem exigir a
permissão) — a resposta (`toChannelResponse`) já não inclui token/config nenhum, só
nome/tipo/telefone/status/wabaId, e duas outras telas dependem dela mesmo para um
gerente sem a permissão: o filtro por canal na Dashboard de Atendimento
(`AttendanceDashboardPage.jsx`'s `useChannels(true)`) e o aviso de canal desconectado
(`ChannelStatusBanner.jsx`).

`authenticateQrRoute` (linha 30-46) troca `req.agent.role !== 'admin'` por
`!hasIntegrationsAccess(req.agent)`.

## 8. Backend — Integrações (`src/api/admin-integrations.routes.js`)

Todas as 6 rotas (`GET`/`POST`/`PUT /sgp`, `POST /sgp/:id/rotate-key`,
`GET`/`PUT /sgp-query-config`) trocam `requireRole('admin')` por
`requireIntegrationsAccess` — sem exceção de leitura aqui, porque nenhuma outra tela do
sistema depende delas (busca de cliente/contrato/fatura durante o atendimento usa uma
família de rotas totalmente separada, `/api/sgp/*`, que não muda nesta feature).

## 9. Backend — IA (`src/api/admin-ai.routes.js`)

Só duas das sete rotas seguram a chave da OpenAI: `PUT /config` (grava a chave) e
`POST /test-connection` (testa a chave, recebida no corpo ou a já salva) — as duas
trocam `requireRole('admin')` por `requireIntegrationsAccess`.

As outras cinco ficam como `requireRole('admin')` (abertas por herança):
`GET /config` (a resposta combina `apiKeyLast4`/`configured` — nunca a chave inteira —
com todos os campos de triagem/transcrição/janela noturna; precisa continuar aberta
porque as telas de Triagem com IA e Transcrição leem esse mesmo objeto pra editar os
campos que não são credencial), `PUT /transcription`, `PUT /triage`, `GET /tools`,
`PUT /tools/:nome`.

## 10. Frontend

- **`ProtectedRoute.jsx`**: `requireAdmin` passa a checar
  `agent.role !== 'admin' && agent.role !== 'manager'` (era só `!== 'admin'`).
- **`NavRail.jsx`**: o bloco `agent?.role === 'admin'` que mostra "Dashboard de
  atendimento" e "Administração" passa a incluir `manager`. O ícone "Atendimentos
  encerrados" (hoje escondido só pra admin, `agent?.role !== 'admin'`) passa a esconder
  pra manager também — mesmo motivo do admin: ele usa a Dashboard de Atendimento pra
  isso, não a fila pessoal.
- **`ChannelStatusBanner.jsx`**: a variável `isAdmin` (que hoje controla se o aviso de
  canal desconectado aparece e dispara a busca) vira "tem acesso a Integrações"
  (`agent?.role === 'admin' || (agent?.role === 'manager' && agent?.canManageIntegrations)`)
  — um aviso que só quem pode ir lá consertar precisa ver.
- **`CreateAgentForm.jsx`**: o seletor de papel ganha "Gerente". Selecionado, aparece um
  checkbox "Pode gerenciar Canais e Integrações" (`canManageIntegrations`, enviado no
  corpo do `POST /api/admin/agents`). Só existe na criação — sem tela de editar depois
  (decisão 5).
- **`AgentsAdminTab.jsx`**: `roleLabel` ganha o terceiro caso, "Gerente".
- **`AdminChannelsPage.jsx`**: `SECTION_GROUPS` filtra o item `channels` (mantém
  `triage`, que está no mesmo grupo visual "Canais" mas não é sensível) e o grupo
  inteiro "Integrações", quando `agent.role === 'manager' && !agent.canManageIntegrations`
  — admin sempre vê tudo. O `useState('channels')` que define a aba inicial passa a
  calcular a primeira aba realmente visível para aquele usuário (evita abrir numa aba
  que acabou de sumir do menu).

## 11. Testes

Backend (Jest):

- `auth.middleware.test.js` (arquivo existente) — `requireRole('admin')` aceitando
  `manager` além de `admin`, recusando `agent`; `requireIntegrationsAccess` liberando
  admin sempre, manager só com a flag, recusando atendente; `hasIntegrationsAccess` como
  função pura, os mesmos três casos.
- `admin-agents.routes.test.js` (arquivo existente) — gerente criando atendente (201);
  gerente tentando criar `role: 'admin'` ou `role: 'manager'` (403); gerente ativando
  senha/setores de um atendente (sucesso) vs. de um admin/gerente (403); `POST /` salvando
  `canManageIntegrations` só quando `role: 'manager'`.
- `agent.repository.test.js` (arquivo existente) — `createAgent`/`findAgentById`/
  `listAgents`/`setAgentActive`/`updateAgentProfile` preservando `canManageIntegrations`.
- `auth.service.test.js` (arquivo existente) — `login` embutindo `canManageIntegrations`
  no token e na resposta.
- `admin-channels.routes.test.js` (arquivo existente) — `GET /` liberado pra manager sem
  a flag; `POST`/`PATCH`/`DELETE`/`reconnect`/`qr` recusados pra manager sem a flag,
  liberados com a flag.
- `admin-integrations.routes.test.js` (arquivo existente) — as 6 rotas recusando manager
  sem a flag.
- `admin-ai.routes.test.js` (arquivo existente) — `PUT /config` e `POST /test-connection`
  recusando manager sem a flag; `GET /config`/`PUT /triage`/`PUT /transcription`/
  `GET /tools`/`PUT /tools/:nome` liberados pra manager sem a flag (prova a divisão fina
  dentro do mesmo arquivo).

Frontend (Vitest):

- `CreateAgentForm.test.jsx` (arquivo existente) — opção "Gerente" aparecendo; checkbox
  de Integrações só aparecendo quando "Gerente" está selecionado; enviado no payload.
- `AgentsAdminTab.test.jsx` (arquivo existente) — rótulo "Gerente" na lista.
- `AdminChannelsPage.test.jsx` (arquivo existente) — item Canais e grupo Integrações
  escondidos pra manager sem a flag; aba inicial não cai numa aba escondida.
- `NavRail.test.jsx`, `ChannelStatusBanner.test.jsx` (arquivos existentes) — casos novos
  pro papel manager, com e sem a flag.
- `App.test.jsx` (arquivo existente) — manager acessando `/admin/channels` e
  `/admin/dashboard` sem redirecionar.

## 12. Fora de escopo (YAGNI)

- Editar papel ou permissão de uma conta já criada — mesma regra que já vale hoje pro
  papel admin/atendente.
- Gerente criar outro gerente ou admin.
- Sistema de permissões genérico por flag individual — só essa exceção
  (Canais+Integrações+chave de IA) existe hoje.
- Revogar/forçar logout de um token já emitido quando a permissão muda — mesma
  característica que mudança de papel já tem hoje.
- Qualquer mudança em `/api/sgp/*` (busca de cliente durante o atendimento) — família de
  rotas separada, não sensível ao papel de quem chama, fora do escopo desta mudança.
