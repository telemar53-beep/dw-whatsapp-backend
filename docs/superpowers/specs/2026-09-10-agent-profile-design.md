# Meu perfil (atendente)

**Status:** Aprovado (aguardando revisão final do usuário antes do plano de implementação)
**Data:** 2026-09-10

## 1. Problema e objetivo

Hoje o botão "Trocar senha" na barra lateral (`NavRail.jsx`) abre um popup só com os 3
campos de troca de senha (`ChangePasswordModal.jsx`). O usuário quer substituir esse
botão por "Meu perfil", que abre um popup mais completo: foto do atendente, nome
completo, telefone, e-mail, além da troca de senha que já existe.

Decisões tomadas com o usuário durante o brainstorm:
- **E-mail é somente leitura** neste popup — é o identificador de login, editar exige um
  fluxo próprio de revalidação que não está nesse escopo. Se um dia precisar mudar, é via
  admin (fora deste projeto de features, se vier a ser pedido).
- **Telefone é texto livre, opcional, sem validação de formato** — campo puramente
  informativo, não é usado por nenhuma lógica de mensageria.
- **A foto também aparece no Painel de Equipe** (`TeamPanel.jsx`), não só dentro do
  popup — ao lado do nome de cada colega, substituindo o espaço vazio ao lado da bolinha
  de online/offline.
- **A foto pode ser removida**, voltando ao ícone/iniciais padrão.

## 2. Modelo de dados

Migração nova, duas colunas nullable em `agents` (nenhum dado existente quebra — todo
atendente atual nasce sem foto/telefone até preencher):

```sql
ALTER TABLE agents ADD COLUMN phone TEXT;
ALTER TABLE agents ADD COLUMN avatar_path TEXT;
```

`avatar_path` segue exatamente o mesmo padrão já usado por `contacts.avatar_path`: um
nome de arquivo relativo dentro de `MEDIA_STORAGE_DIR`, gerenciado pelo
`src/media/media-storage.js` já existente (`saveMediaFile`/`getMediaFilePath`) — nenhuma
mudança nesse módulo é necessária, só reuso.

## 3. Backend — API

Todas as rotas novas vivem em `src/api/agents.routes.js` (arquivo que já expõe
`GET /api/agents`, aberto a qualquer atendente autenticado — não é admin-only). Nenhuma
rota admin (`admin-agents.routes.js`) muda.

- **`GET /api/agents/me`** — retorna o perfil completo do próprio atendente:
  `{id, name, email, phone, avatarPath, role}`.
- **`PATCH /api/agents/me`** — body `{name, phone}`. `name` obrigatório e não-vazio
  (mesma regra já aplicada na criação de atendente); `phone` aceita string ou
  `null`/vazio para limpar. Atualiza os dois campos juntos (não é um patch parcial —
  o formulário sempre envia ambos).
- **`POST /api/agents/me/avatar`** — multipart, campo `file`. Usa `multer` com
  armazenamento em memória (mesmo padrão de `conversations.routes.js`), limite de
  **5MB**, aceita só `image/jpeg`, `image/png`, `image/webp`, `image/gif`. Salva via
  `saveMediaFile` e grava o caminho em `agents.avatar_path`.
- **`DELETE /api/agents/me/avatar`** — limpa `avatar_path` (seta `NULL`). Idempotente:
  chamar quando já não há foto não é erro. Não apaga o arquivo físico antigo do disco —
  mesmo comportamento já aceito hoje para avatar de contato e mídia de mensagens (não é
  uma lacuna nova introduzida por esta feature).
- **`GET /api/agents/:id/avatar?token=...`** — serve a imagem. Autenticação por token na
  query string, replicando **exatamente** `authenticateContactRoute` de
  `src/api/contacts.routes.js` (aceita `Authorization: Bearer` OU `?token=`). Qualquer
  atendente autenticado pode ver a foto de qualquer colega (necessário para o Painel de
  Equipe). 404 se o agente não existe ou não tem foto; 401 se o token for inválido/ausente.
- **`GET /api/agents`** (lista, já existe) ganha o campo `avatarPath` em cada item da
  resposta.

`src/agents/agent.repository.js` ganha:
- `updateAgentProfile(id, { name, phone })` — `UPDATE agents SET name = $2, phone = $3
  WHERE id = $1 RETURNING ...`.
- `setAgentAvatarPath(id, avatarPath)` — mesmo padrão de `setContactAvatarPath` em
  `contact.repository.js`.
- `toPublicAgent` e `findAgentById` passam a incluir `phone` e `avatarPath`.

## 4. Frontend

**`NavRail.jsx`:** o `RailButton` "Trocar senha" (ícone `IconKey`) vira "Meu perfil"
(novo ícone `IconUser`, adicionado em `WaIcons.jsx` seguindo o estilo SVG já usado pelos
outros ícones do arquivo). `onChangePasswordClick` vira `onProfileClick`.

**`DashboardPage.jsx`:** o estado `changingPassword`/render de `ChangePasswordModal` é
substituído por `profileOpen`/render do novo `ProfileModal`.

**`ProfileModal.jsx`** (novo, usa o `WaDialog` compartilhado como todo modal do projeto):
- Ao abrir, busca `GET /api/agents/me` para carregar os dados atuais.
- **Foto:** círculo com a foto atual (via `AgentAvatar`, veja abaixo) ou iniciais do
  nome; botão "Alterar foto" (input `type="file"`, aceita apenas imagem) chama
  `POST /me/avatar` imediatamente ao escolher o arquivo (não espera o botão Salvar,
  evitando reenviar a imagem toda vez que só o nome muda); botão "Remover foto"
  (só visível quando há foto) chama `DELETE /me/avatar`.
- **Nome** e **Telefone:** campos de texto editáveis.
- **E-mail:** texto simples, não editável.
- Um botão "Salvar" que envia nome+telefone via `PATCH /api/agents/me`.
- **Seção "Trocar senha":** os 3 campos (senha atual/nova/confirmar) que hoje vivem
  sozinhos em `ChangePasswordModal.jsx` passam a ser uma seção dentro deste popup, com
  seu próprio botão de submit — continua chamando `PUT /api/auth/password`, sem mudança
  no backend de senha. `ChangePasswordModal.jsx` deixa de existir como modal
  independente; sua lógica migra para dentro de `ProfileModal.jsx`.

**`AgentAvatar.jsx`** (novo componente, espelha `ContactAvatar.jsx` exatamente): props
`agentId`, `avatarPath`, `name`, `size` — mostra a foto via nova `agentAvatarUrl(agentId,
token)` (`services/api.js`) quando há `avatarPath`, senão mostra a primeira letra do
nome (mesmo fallback visual do `ContactAvatar`).

**`TeamPanel.jsx`:** cada linha da lista de colegas ganha um `<AgentAvatar>` ao lado do
nome (a bolinha de online/offline continua exatamente como está).

**`useAgents.js`:** passa a expor uma função `refresh()` (mesmo padrão já usado por
`useChannels`/`useQuickReplies` neste projeto), para que `ProfileModal` consiga disparar
uma atualização da lista assim que o próprio nome/foto mudar — sem isso, a própria linha
do atendente no Painel de Equipe ficaria com dado desatualizado até um F5.

**`services/api.js`:** novas funções `getMyProfile(token)`, `updateMyProfile({name,
phone}, token)`, `uploadMyAvatar(file, token)`, `deleteMyAvatar(token)`,
`agentAvatarUrl(agentId, token)` — todas espelhando as funções equivalentes já
existentes para contato (`avatarUrl`) e troca de senha (`changePassword`).

## 5. Erros e casos de borda

- `PATCH /me` com nome vazio → 400 (mesma mensagem/padrão da criação de atendente).
- `POST /me/avatar` com tipo de arquivo inválido → 400; arquivo maior que 5MB → 400
  (mesmo padrão de erro do multer já tratado em `/:id/messages`); request sem arquivo →
  400.
- `DELETE /me/avatar` sem foto existente → 200, no-op.
- `GET /:id/avatar` sem token ou token inválido → 401; agente inexistente ou sem foto →
  404.
- Erros de rede/validação no popup mostram mensagem inline, mesmo padrão já usado pelo
  `ChangePasswordModal` atual.

## 6. Testes

- Backend: `agent.repository.test.js` (novo cobertura de `updateAgentProfile`,
  `setAgentAvatarPath`); `agents.routes.test.js` (todas as rotas novas — sucesso, nome
  vazio, arquivo inválido, arquivo grande demais, token ausente/inválido no avatar,
  avatar inexistente, remoção idempotente).
- Frontend: `ProfileModal.test.jsx` (novo — carrega perfil, salva nome/telefone, sobe
  foto, remove foto, seção de troca de senha funcionando, substitui
  `ChangePasswordModal.test.jsx`); `AgentAvatar.test.jsx` (novo, espelha
  `ContactAvatar.test.jsx`); `NavRail.test.jsx` (botão renomeado); `TeamPanel.test.jsx`
  (avatar aparecendo em cada linha); `useAgents.test.jsx` (expõe `refresh`).

## 7. Fora de escopo (YAGNI, deliberado)

- Edição de e-mail pelo próprio atendente.
- Foto aparecendo em outros lugares além do popup e do Painel de Equipe (ex: lista de
  atendentes no admin, modal de transferência) — não foi pedido; pode ser um pedido
  futuro separado.
- Limpeza de arquivos de avatar antigos no disco ao trocar/remover foto — consistente
  com o comportamento já aceito hoje pelo resto do projeto para mídia e avatar de
  contato.
