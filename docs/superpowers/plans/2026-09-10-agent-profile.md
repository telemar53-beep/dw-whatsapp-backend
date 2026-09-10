# Meu perfil (atendente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o botão "Trocar senha" da barra lateral por "Meu perfil", que abre
um popup com foto (upload/remoção), nome, telefone, e-mail (somente leitura) e a troca
de senha já existente.

**Architecture:** Duas colunas novas (`phone`, `avatar_path`) em `agents`. Um conjunto
pequeno de rotas novas em `src/api/agents.routes.js` (perfil próprio + avatar),
reaproveitando `src/media/media-storage.js` (já usado por anexos de mensagem) para o
armazenamento da foto, e o mesmo padrão de rota autenticada-por-query-token já usado por
`GET /api/contacts/:contactId/avatar` para servir a imagem. No frontend, um novo
`ProfileModal.jsx` substitui `ChangePasswordModal.jsx` (cuja lógica de troca de senha
migra para dentro do novo popup como uma seção), um novo `AgentAvatar.jsx` espelha
`ContactAvatar.jsx`, e o Painel de Equipe (`TeamPanel.jsx`) passa a mostrar a foto de
cada colega.

**Tech Stack:** Node.js/Express, PostgreSQL (node-pg-migrate), multer (upload em
memória, já usado em `conversations.routes.js`), React, Vitest + Testing Library
(frontend), Jest + supertest (backend).

**Spec:** `docs/superpowers/specs/2026-09-10-agent-profile-design.md`

## Global Constraints

- E-mail é **somente leitura** neste popup — nenhuma rota deste plano permite ao próprio
  atendente mudar seu e-mail.
- Telefone é texto livre, opcional, **sem validação de formato**.
- Limite de upload de avatar: **5MB**, apenas `image/jpeg`, `image/png`, `image/webp`,
  `image/gif`.
- `DELETE /me/avatar` é idempotente e **não apaga o arquivo físico antigo do disco** —
  mesmo comportamento já aceito hoje para avatar de contato e mídia de mensagem; não é
  uma lacuna nova desta feature.
- `NavRail.jsx` é compartilhado por 4 páginas top-level
  (`DashboardPage.jsx`, `AttendanceDashboardPage.jsx`, `MetricsPage.jsx`,
  `AdminChannelsPage.jsx`) — cada uma tem seu próprio estado `changingPassword` e seu
  próprio `<ChangePasswordModal>`. As 4 precisam ser atualizadas juntas (Task 8).
- `TeamPanel.jsx` só é renderizado em `DashboardPage.jsx` — o mecanismo de atualização
  "minha foto/nome aparece sem precisar de F5" (Task 8) só precisa existir ali.
- Todo commit git termina com o trailer `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` — repita isto literalmente em todo dispatch de implementador.

---

### Task 1: Migração + `agent.repository.js` (telefone e foto)

**Files:**
- Create: `migrations/1788900000000_add-phone-and-avatar-to-agents.js`
- Modify: `src/agents/agent.repository.js`
- Test: `src/agents/agent.repository.test.js`

**Interfaces:**
- Produces: `toPublicAgent(row)` agora inclui `phone`/`avatarPath`; `findAgentById(id)`
  e `listAgents()` agora retornam esses dois campos; nova
  `updateAgentProfile(id, {name, phone})` → agente atualizado ou `null` se não existe;
  nova `setAgentAvatarPath(id, avatarPath)` → `void` (mesmo padrão de
  `setContactAvatarPath` em `contact.repository.js`, `avatarPath` pode ser `null` para
  limpar). Consumido pela Task 2 (`updateAgentProfile`, rotas `/me`) e Task 3
  (`setAgentAvatarPath`, rotas de avatar).

- [ ] **Step 1: Escrever a migração**

```js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_path TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE agents DROP COLUMN IF EXISTS phone;
    ALTER TABLE agents DROP COLUMN IF EXISTS avatar_path;
  `);
};
```

- [ ] **Step 2: Rodar a migração no banco de dev local**

Run: `npm run migrate up`
Expected: relata sucesso. As duas colunas nascem `NULL` para todo agente existente.

- [ ] **Step 3: Escrever os testes que falham**

Adicionar ao final do bloco `describe('agent repository', ...)` em
`src/agents/agent.repository.test.js` (junto ao import existente, adicionar
`updateAgentProfile` e `setAgentAvatarPath` na lista desestruturada):

```js
  test('findAgentById includes phone and avatarPath (both null by default)', async () => {
    const created = await createAgent({ name: 'Helena', email: 'h@dw.com', password: 'secret123', role: 'agent' });
    const agent = await findAgentById(created.id);
    expect(agent.phone).toBeNull();
    expect(agent.avatarPath).toBeNull();
  });

  test('updateAgentProfile updates name and phone', async () => {
    const created = await createAgent({ name: 'Igor', email: 'i@dw.com', password: 'secret123', role: 'agent' });

    const updated = await updateAgentProfile(created.id, { name: 'Igor Silva', phone: '11999998888' });

    expect(updated.name).toBe('Igor Silva');
    expect(updated.phone).toBe('11999998888');
  });

  test('updateAgentProfile clears phone when given null', async () => {
    const created = await createAgent({ name: 'Julia', email: 'j@dw.com', password: 'secret123', role: 'agent' });
    await updateAgentProfile(created.id, { name: 'Julia', phone: '11999998888' });

    const updated = await updateAgentProfile(created.id, { name: 'Julia', phone: null });

    expect(updated.phone).toBeNull();
  });

  test('updateAgentProfile returns null when the agent does not exist', async () => {
    const result = await updateAgentProfile('00000000-0000-0000-0000-000000000000', { name: 'X', phone: null });
    expect(result).toBeNull();
  });

  test('setAgentAvatarPath sets and then clears the avatar path', async () => {
    const created = await createAgent({ name: 'Karen', email: 'k@dw.com', password: 'secret123', role: 'agent' });

    await setAgentAvatarPath(created.id, 'avatars/karen.jpg');
    expect((await findAgentById(created.id)).avatarPath).toBe('avatars/karen.jpg');

    await setAgentAvatarPath(created.id, null);
    expect((await findAgentById(created.id)).avatarPath).toBeNull();
  });
```

- [ ] **Step 4: Rodar os testes para confirmar que falham**

Run: `npx jest src/agents/agent.repository.test.js`
Expected: FAIL — `updateAgentProfile is not a function` / `setAgentAvatarPath is not a
function` / `avatarPath` undefined em vez de `null`.

- [ ] **Step 5: Implementar**

Em `src/agents/agent.repository.js`, atualizar `toPublicAgent`:

```js
function toPublicAgent(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    phone: row.phone,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
  };
}
```

Atualizar `findAgentById`:

```js
async function findAgentById(id) {
  const result = await getPool().query(
    'SELECT id, name, email, role, active, phone, avatar_path, created_at FROM agents WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}
```

Atualizar a query de `listAgents` (só a lista de colunas selecionadas de `a`, o resto do
`GROUP BY`/join de setores fica igual):

```js
async function listAgents() {
  const result = await getPool().query(`
    SELECT a.id, a.name, a.email, a.role, a.active, a.phone, a.avatar_path, a.created_at,
           COALESCE(
             json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL),
             '[]'
           ) AS sectors
    FROM agents a
    LEFT JOIN agent_sectors ags ON ags.agent_id = a.id
    LEFT JOIN sectors s ON s.id = ags.sector_id
    GROUP BY a.id
    ORDER BY a.email ASC
  `);
  return result.rows.map((row) => ({ ...toPublicAgent(row), sectors: row.sectors }));
}
```

Adicionar as duas funções novas (perto de `setAgentActive`/`updateAgentPassword`):

```js
async function updateAgentProfile(id, { name, phone }) {
  const result = await getPool().query(
    `UPDATE agents SET name = $2, phone = $3 WHERE id = $1
     RETURNING id, name, email, role, active, phone, avatar_path, created_at`,
    [id, name, phone || null]
  );
  if (result.rowCount === 0) return null;
  return toPublicAgent(result.rows[0]);
}

async function setAgentAvatarPath(id, avatarPath) {
  await getPool().query('UPDATE agents SET avatar_path = $2 WHERE id = $1', [id, avatarPath]);
}
```

Adicionar `updateAgentProfile` e `setAgentAvatarPath` ao `module.exports`.

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `npx jest src/agents/agent.repository.test.js`
Expected: PASS, todos verdes (inclusive os testes já existentes no arquivo).

- [ ] **Step 7: Commit**

```bash
git add migrations/1788900000000_add-phone-and-avatar-to-agents.js src/agents/agent.repository.js src/agents/agent.repository.test.js
git commit -m "$(cat <<'EOF'
Add phone and avatar columns to agents, with repository support

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rotas de perfil próprio — `GET /me` e `PATCH /me`

**Files:**
- Modify: `src/api/agents.routes.js`
- Test: `src/api/agents.routes.test.js` (novo arquivo — nenhum teste existe hoje para
  este arquivo de rotas)

**Interfaces:**
- Consumes: `findAgentById`, `updateAgentProfile` (Task 1).
- Produces: `GET /api/agents/me` → `{id, name, email, phone, avatarPath, role}` do
  próprio agente autenticado; `PATCH /api/agents/me` (body `{name, phone}`) → mesmo
  formato, 400 se `name` vazio/ausente. `GET /api/agents` (lista, já existe) ganha
  `avatarPath` em cada item. Consumido pela Task 4 (cliente frontend) e Task 7
  (`ProfileModal`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/api/agents.routes.test.js`:

```js
jest.mock('../agents/agent.repository');
jest.mock('../realtime/presence');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents, findAgentById, updateAgentProfile } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');
const agentsRoutes = require('./agents.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/agents', () => {
  test('includes avatarPath for each agent', async () => {
    listAgents.mockResolvedValue([{ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', avatarPath: 'avatars/a1.jpg' }]);
    isAgentOnline.mockReturnValue(false);

    const res = await request(buildApp())
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body[0].avatarPath).toBe('avatars/a1.jpg');
  });
});

describe('GET /api/agents/me', () => {
  test('returns the authenticated agent\'s own profile', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', phone: '11999998888', avatarPath: null });

    const res = await request(buildApp())
      .get('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(findAgentById).toHaveBeenCalledWith('agent-1');
    expect(res.body).toEqual({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: '11999998888', avatarPath: null, role: 'agent' });
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/agents/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/agents/me', () => {
  test('updates name and phone', async () => {
    updateAgentProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana Paula', email: 'ana@dw.com', role: 'agent', phone: '11988887777', avatarPath: null });

    const res = await request(buildApp())
      .patch('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Ana Paula', phone: '11988887777' });

    expect(res.status).toBe(200);
    expect(updateAgentProfile).toHaveBeenCalledWith('agent-1', { name: 'Ana Paula', phone: '11988887777' });
    expect(res.body.name).toBe('Ana Paula');
  });

  test('treats a missing phone as null', async () => {
    updateAgentProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', phone: null, avatarPath: null });

    await request(buildApp())
      .patch('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Ana' });

    expect(updateAgentProfile).toHaveBeenCalledWith('agent-1', { name: 'Ana', phone: null });
  });

  test('returns 400 when name is blank', async () => {
    const res = await request(buildApp())
      .patch('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: '   ', phone: '11999998888' });

    expect(res.status).toBe(400);
    expect(updateAgentProfile).not.toHaveBeenCalled();
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).patch('/api/agents/me').send({ name: 'Ana' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx jest src/api/agents.routes.test.js`
Expected: FAIL — `GET /me`/`PATCH /me` retornam 404 (rota não existe), `avatarPath`
ausente na resposta de `GET /`.

- [ ] **Step 3: Implementar**

Reescrever `src/api/agents.routes.js`:

```js
const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents, findAgentById, updateAgentProfile } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const agents = await listAgents();
  res.json(
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      avatarPath: agent.avatarPath,
      online: isAgentOnline(agent.id),
    }))
  );
});

router.get('/me', requireAuth, async (req, res) => {
  const agent = await findAgentById(req.agent.agentId);
  res.json({ id: agent.id, name: agent.name, email: agent.email, phone: agent.phone, avatarPath: agent.avatarPath, role: agent.role });
});

router.patch('/me', requireAuth, async (req, res) => {
  const { name, phone } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  const agent = await updateAgentProfile(req.agent.agentId, { name: trimmedName, phone: phone || null });
  res.json({ id: agent.id, name: agent.name, email: agent.email, phone: agent.phone, avatarPath: agent.avatarPath, role: agent.role });
});

module.exports = router;
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx jest src/api/agents.routes.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add src/api/agents.routes.js src/api/agents.routes.test.js
git commit -m "$(cat <<'EOF'
Add GET/PATCH /api/agents/me and expose avatarPath in the agent list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rotas de avatar — upload, remoção e exibição

**Files:**
- Modify: `src/api/agents.routes.js`
- Test: `src/api/agents.routes.test.js`

**Interfaces:**
- Consumes: `setAgentAvatarPath`, `findAgentById` (Task 1); `saveMediaFile`,
  `getMediaFilePath`, `extensionForMimeType` de `src/media/media-storage.js` (já
  existe); `verifyToken` de `src/auth/auth.service.js` (já existe, usado por
  `contacts.routes.js` no mesmo padrão).
- Produces: `POST /api/agents/me/avatar` (multipart, campo `file`) → `201` com
  `{avatarPath}`; `DELETE /api/agents/me/avatar` → `200 {ok: true}`;
  `GET /api/agents/:id/avatar?token=...` → serve a imagem (200), 404 sem foto/agente,
  401 sem token válido. Consumido pela Task 4 (cliente frontend) e Task 5
  (`AgentAvatar`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao topo de `src/api/agents.routes.test.js`, junto aos mocks existentes:

```js
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
  getMediaFilePath: jest.fn(),
}));
```

E aos imports:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setAgentAvatarPath } = require('../agents/agent.repository');
const { saveMediaFile, getMediaFilePath } = require('../media/media-storage');
```

(`setAgentAvatarPath` entra na mesma linha de destructuring do `jest.mock('../agents/agent.repository')` já existente.)

Adicionar ao final do arquivo:

```js
describe('POST /api/agents/me/avatar', () => {
  test('saves the uploaded image and sets it as the avatar', async () => {
    saveMediaFile.mockResolvedValue('avatars/generated-name.jpg');
    setAgentAvatarPath.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .post('/api/agents/me/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'foto.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(saveMediaFile).toHaveBeenCalledWith(expect.any(Buffer), '.jpg');
    expect(setAgentAvatarPath).toHaveBeenCalledWith('agent-1', 'avatars/generated-name.jpg');
    expect(res.body).toEqual({ avatarPath: 'avatars/generated-name.jpg' });
  });

  test('rejects a non-image file with 400', async () => {
    const res = await request(buildApp())
      .post('/api/agents/me/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.from('not an image'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(setAgentAvatarPath).not.toHaveBeenCalled();
  });

  test('rejects a request with no file with 400', async () => {
    const res = await request(buildApp())
      .post('/api/agents/me/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(400);
  });

  test('rejects a file larger than 5MB', async () => {
    const res = await request(buildApp())
      .post('/api/agents/me/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.alloc(6 * 1024 * 1024), { filename: 'grande.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/agents/me/avatar')
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'foto.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/agents/me/avatar', () => {
  test('clears the avatar path', async () => {
    setAgentAvatarPath.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .delete('/api/agents/me/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(setAgentAvatarPath).toHaveBeenCalledWith('agent-1', null);
  });
});

describe('GET /api/agents/:id/avatar', () => {
  let tempFile;

  beforeEach(() => {
    tempFile = path.join(os.tmpdir(), `dw-agent-avatar-route-test-${Date.now()}.jpg`);
    fs.writeFileSync(tempFile, 'conteudo de imagem falso');
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  test('serves the file when the agent has an avatar', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-2', avatarPath: 'whatever.jpg' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/agents/agent-2/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  test('accepts the token via query string', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-2', avatarPath: 'whatever.jpg' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp()).get(`/api/agents/agent-2/avatar?token=${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token', async () => {
    const res = await request(buildApp()).get('/api/agents/agent-2/avatar');
    expect(res.status).toBe(401);
  });

  test('returns 404 when the agent has no avatar', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-2', avatarPath: null });
    const res = await request(buildApp())
      .get('/api/agents/agent-2/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the agent does not exist', async () => {
    findAgentById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/agents/does-not-exist/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx jest src/api/agents.routes.test.js`
Expected: FAIL — as três rotas novas não existem (404).

- [ ] **Step 3: Implementar**

Adicionar no topo de `src/api/agents.routes.js`:

```js
const multer = require('multer');
const { verifyToken } = require('../auth/auth.service');
const { setAgentAvatarPath } = require('../agents/agent.repository');
const { saveMediaFile, getMediaFilePath, extensionForMimeType } = require('../media/media-storage');
```

(`setAgentAvatarPath` entra na mesma linha de import de `agent.repository` já criada na
Task 2.)

Adicionar, depois das declarações de `router`:

```js
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function authenticateAgentAvatarRoute(req, res, next) {
  const header = req.headers.authorization;
  const headerToken = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const token = headerToken || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    req.agent = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  next();
}
```

Adicionar as três rotas depois de `PATCH /me` (antes do `module.exports`):

```js
router.post('/me/avatar', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'file is required' });
  }
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.mimetype)) {
    return res.status(400).json({ error: 'File must be an image (jpeg, png, webp or gif)' });
  }
  const avatarPath = await saveMediaFile(file.buffer, extensionForMimeType(file.mimetype));
  await setAgentAvatarPath(req.agent.agentId, avatarPath);
  res.status(200).json({ avatarPath });
});

// eslint-disable-next-line no-unused-vars
router.use('/me/avatar', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File exceeds the 5MB upload limit' });
  }
  next(err);
});

router.delete('/me/avatar', requireAuth, async (req, res) => {
  await setAgentAvatarPath(req.agent.agentId, null);
  res.status(200).json({ ok: true });
});

router.get('/:id/avatar', authenticateAgentAvatarRoute, async (req, res) => {
  const agent = await findAgentById(req.params.id);
  if (!agent || !agent.avatarPath) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  res.type('image/jpeg');
  res.sendFile(getMediaFilePath(agent.avatarPath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Avatar not found' });
    }
  });
});
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx jest src/api/agents.routes.test.js`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add src/api/agents.routes.js src/api/agents.routes.test.js
git commit -m "$(cat <<'EOF'
Add avatar upload, removal and serving routes for the agent's own profile

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Cliente frontend — `services/api.js`

**Files:**
- Modify: `frontend/src/services/api.js`

**Interfaces:**
- Consumes: as rotas das Tasks 2 e 3.
- Produces: `getMyProfile(token)`, `updateMyProfile({name, phone}, token)`,
  `uploadMyAvatar(file, token)`, `deleteMyAvatar(token)`, `agentAvatarUrl(agentId,
  token)`. Consumido pela Task 5 (`AgentAvatar`) e Task 7 (`ProfileModal`).

- [ ] **Step 1: Implementar**

Nenhum teste de unidade dedicado existe para `services/api.js` neste projeto (é testado
indiretamente pelos componentes que o consomem, mockado via `vi.mock('../services/api')`
— ver `ChangePasswordModal.test.jsx`). Adicionar ao final do arquivo:

```js
export function getMyProfile(token) {
  return apiFetch('/api/agents/me', { token });
}

export function updateMyProfile({ name, phone }, token) {
  return apiFetch('/api/agents/me', { method: 'PATCH', body: { name, phone }, token });
}

export function uploadMyAvatar(file, token) {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch('/api/agents/me/avatar', { method: 'POST', body: formData, token });
}

export function deleteMyAvatar(token) {
  return apiFetch('/api/agents/me/avatar', { method: 'DELETE', token });
}

export function agentAvatarUrl(agentId, token) {
  return `${API_BASE_URL}/api/agents/${agentId}/avatar?token=${token}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "$(cat <<'EOF'
Add frontend API client functions for the agent profile and avatar routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Componente `AgentAvatar`

**Files:**
- Create: `frontend/src/components/AgentAvatar.jsx`
- Test: `frontend/src/components/AgentAvatar.test.jsx`

**Interfaces:**
- Consumes: `agentAvatarUrl` (Task 4).
- Produces: `<AgentAvatar agentId name avatarPath size={40} />` — mesma interface e
  comportamento visual de `ContactAvatar.jsx` (foto se `avatarPath`, senão iniciais).
  Consumido pela Task 7 (`ProfileModal`) e Task 9 (`TeamPanel`).

- [ ] **Step 1: Escrever os testes que falham**

```js
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentAvatar from './AgentAvatar';
import { useAuth } from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext');

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok-123' });
});

describe('AgentAvatar', () => {
  test('renders the photo with the authenticated avatar URL when avatarPath is set', () => {
    render(<AgentAvatar agentId="a1" avatarPath="avatars/a1.jpg" name="Carlos" />);
    const img = screen.getByRole('img');
    expect(img.src).toBe('http://localhost:3000/api/agents/a1/avatar?token=tok-123');
  });

  test('renders the first letter of the name when there is no avatarPath', () => {
    render(<AgentAvatar agentId="a1" avatarPath={null} name="Carlos" />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  test('renders a question mark fallback when there is no name either', () => {
    render(<AgentAvatar agentId="a1" avatarPath={null} name={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd frontend && npx vitest run src/components/AgentAvatar.test.jsx`
Expected: FAIL — módulo `./AgentAvatar` não existe.

- [ ] **Step 3: Implementar**

```js
import { useAuth } from '../contexts/AuthContext';
import { agentAvatarUrl } from '../services/api';

function initialFor(name) {
  const trimmed = name ? name.trim() : '';
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function AgentAvatar({ agentId, avatarPath, name, size = 40 }) {
  const { token } = useAuth();
  const boxStyle = { width: size, height: size };

  if (avatarPath) {
    return (
      <img
        src={agentAvatarUrl(agentId, token)}
        alt={name || 'Atendente'}
        style={boxStyle}
        className="shrink-0 rounded-full bg-[#dfe5e7] object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...boxStyle, fontSize: Math.round(size * 0.4) }}
      className="flex shrink-0 select-none items-center justify-center rounded-full bg-[#dfe5e7] font-medium text-[#8696a0]"
    >
      {initialFor(name)}
    </span>
  );
}

export default AgentAvatar;
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/components/AgentAvatar.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AgentAvatar.jsx frontend/src/components/AgentAvatar.test.jsx
git commit -m "$(cat <<'EOF'
Add AgentAvatar component, mirroring ContactAvatar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Botão "Meu perfil" no `NavRail`

**Files:**
- Modify: `frontend/src/components/icons/WaIcons.jsx`
- Modify: `frontend/src/components/NavRail.jsx`
- Test: `frontend/src/components/NavRail.test.jsx`

**Interfaces:**
- Produces: novo ícone `IconUser`; `NavRail` troca a prop `onChangePasswordClick` por
  `onProfileClick`, e o botão exibido passa a se chamar "Meu perfil". Consumido pela
  Task 8 (as 4 páginas).

- [ ] **Step 1: Atualizar o teste que existe (ele vai falhar até o Step 3)**

Em `frontend/src/components/NavRail.test.jsx`, substituir o teste
`'calls onChangePasswordClick when Trocar senha is clicked'` por:

```js
  test('calls onProfileClick when Meu perfil is clicked', async () => {
    const onProfileClick = vi.fn();
    renderRail({ onProfileClick });
    await userEvent.click(screen.getByLabelText('Meu perfil'));
    expect(onProfileClick).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd frontend && npx vitest run src/components/NavRail.test.jsx`
Expected: FAIL — não existe elemento com `aria-label` "Meu perfil".

- [ ] **Step 3: Implementar**

Em `frontend/src/components/icons/WaIcons.jsx`, adicionar (perto de `IconKey`, mesmo
estilo de `<Svg>` + `<path>` dos ícones vizinhos):

```js
export function IconUser(props) {
  return (
    <Svg {...props}>
      <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.4 0-9 2.2-9 5.5V22h18v-2.5c0-3.3-4.6-5.5-9-5.5z" />
    </Svg>
  );
}
```

Em `frontend/src/components/NavRail.jsx`:
- Trocar o import `IconKey` por `IconUser` na lista importada de `./icons/WaIcons`.
- Trocar a assinatura da função: `onChangePasswordClick` → `onProfileClick`.
- Trocar o botão:

```jsx
        <RailButton label="Meu perfil" onClick={onProfileClick}>
          <IconUser size={21} />
        </RailButton>
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `cd frontend && npx vitest run src/components/NavRail.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/icons/WaIcons.jsx frontend/src/components/NavRail.jsx frontend/src/components/NavRail.test.jsx
git commit -m "$(cat <<'EOF'
Rename the NavRail password button to Meu perfil

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Componente `ProfileModal` (substitui `ChangePasswordModal`)

**Files:**
- Create: `frontend/src/components/ProfileModal.jsx`
- Create: `frontend/src/components/ProfileModal.test.jsx`
- Delete: `frontend/src/components/ChangePasswordModal.jsx`
- Delete: `frontend/src/components/ChangePasswordModal.test.jsx`

**Interfaces:**
- Consumes: `getMyProfile`, `updateMyProfile`, `uploadMyAvatar`, `deleteMyAvatar`,
  `changePassword` (Task 4, `changePassword` já existe); `AgentAvatar` (Task 5).
- Produces: `<ProfileModal onClose onProfileUpdated? />` — `onProfileUpdated` é chamado
  (se fornecido) toda vez que nome, telefone ou foto são salvos com sucesso. Consumido
  pela Task 8 (as 4 páginas).

- [ ] **Step 1: Escrever os testes que falham**

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileModal from './ProfileModal';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../services/api';

vi.mock('../contexts/AuthContext');
vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'tok-123' });
  api.getMyProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: '11999998888', avatarPath: null, role: 'agent' });
});

describe('ProfileModal', () => {
  test('loads and shows the current profile', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue('Ana')).toBeInTheDocument();
    expect(screen.getByDisplayValue('11999998888')).toBeInTheDocument();
    expect(screen.getByText('ana@dw.com')).toBeInTheDocument();
  });

  test('saves name and phone', async () => {
    api.updateMyProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana Paula', email: 'ana@dw.com', phone: '11988887777', avatarPath: null, role: 'agent' });
    const onProfileUpdated = vi.fn();
    render(<ProfileModal onClose={vi.fn()} onProfileUpdated={onProfileUpdated} />);
    await screen.findByDisplayValue('Ana');

    await userEvent.clear(screen.getByLabelText(/nome completo/i));
    await userEvent.type(screen.getByLabelText(/nome completo/i), 'Ana Paula');
    await userEvent.clear(screen.getByLabelText(/telefone/i));
    await userEvent.type(screen.getByLabelText(/telefone/i), '11988887777');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ name: 'Ana Paula', phone: '11988887777' }, 'tok-123'));
    expect(onProfileUpdated).toHaveBeenCalled();
  });

  test('uploads a new avatar when a file is chosen', async () => {
    api.uploadMyAvatar.mockResolvedValue({ avatarPath: 'avatars/new.jpg' });
    const onProfileUpdated = vi.fn();
    render(<ProfileModal onClose={vi.fn()} onProfileUpdated={onProfileUpdated} />);
    await screen.findByDisplayValue('Ana');

    const file = new File(['fake-bytes'], 'foto.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/alterar foto/i), file);

    await waitFor(() => expect(api.uploadMyAvatar).toHaveBeenCalledWith(file, 'tok-123'));
    expect(onProfileUpdated).toHaveBeenCalled();
  });

  test('removes the avatar when Remover foto is clicked', async () => {
    api.getMyProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: null, avatarPath: 'avatars/a1.jpg', role: 'agent' });
    api.deleteMyAvatar.mockResolvedValue({ ok: true });
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');

    await userEvent.click(screen.getByRole('button', { name: /remover foto/i }));

    await waitFor(() => expect(api.deleteMyAvatar).toHaveBeenCalledWith('tok-123'));
  });

  test('does not show Remover foto when there is no avatar', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');
    expect(screen.queryByRole('button', { name: /remover foto/i })).not.toBeInTheDocument();
  });

  test('changes the password from the embedded section', async () => {
    api.changePassword.mockResolvedValue({ ok: true });
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');

    await userEvent.type(screen.getByLabelText(/senha atual/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^nova senha/i), 'newpass456');
    await userEvent.type(screen.getByLabelText(/confirmar nova senha/i), 'newpass456');
    await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('oldpass123', 'newpass456', 'tok-123'));
    expect(await screen.findByText(/sucesso/i)).toBeInTheDocument();
  });

  test('shows an error when the confirmation password does not match', async () => {
    render(<ProfileModal onClose={vi.fn()} />);
    await screen.findByDisplayValue('Ana');

    await userEvent.type(screen.getByLabelText(/senha atual/i), 'oldpass123');
    await userEvent.type(screen.getByLabelText(/^nova senha/i), 'newpass456');
    await userEvent.type(screen.getByLabelText(/confirmar nova senha/i), 'somethingelse');
    await userEvent.click(screen.getByRole('button', { name: /trocar senha/i }));

    expect(await screen.findByText('As senhas não coincidem')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  test('calls onClose when Fechar is clicked', async () => {
    const onClose = vi.fn();
    render(<ProfileModal onClose={onClose} />);
    await screen.findByDisplayValue('Ana');
    await userEvent.click(screen.getByRole('button', { name: /fechar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd frontend && npx vitest run src/components/ProfileModal.test.jsx`
Expected: FAIL — módulo `./ProfileModal` não existe.

- [ ] **Step 3: Implementar**

```js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyProfile, updateMyProfile, uploadMyAvatar, deleteMyAvatar, changePassword } from '../services/api';
import AgentAvatar from './AgentAvatar';
import WaDialog, { waInputClass, waLabelClass, waPrimaryButtonClass, waGhostButtonClass, waErrorClass } from './WaDialog';

function ProfileModal({ onClose, onProfileUpdated }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  useEffect(() => {
    getMyProfile(token)
      .then((data) => {
        setProfile(data);
        setName(data.name);
        setPhone(data.phone || '');
      })
      .catch(() => {});
  }, [token]);

  async function handleSaveProfile(event) {
    event.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);
    setSavingProfile(true);
    try {
      const updated = await updateMyProfile({ name, phone }, token);
      setProfile(updated);
      setProfileSuccess(true);
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setProfileError((err.body && err.body.error) || 'Falha ao salvar perfil');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const result = await uploadMyAvatar(file, token);
      setProfile((prev) => ({ ...prev, avatarPath: result.avatarPath }));
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError((err.body && err.body.error) || 'Falha ao enviar foto');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await deleteMyAvatar(token);
      setProfile((prev) => ({ ...prev, avatarPath: null }));
      onProfileUpdated && onProfileUpdated();
    } catch (err) {
      setAvatarError((err.body && err.body.error) || 'Falha ao remover foto');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem');
      return;
    }
    setSubmittingPassword(true);
    try {
      await changePassword(currentPassword, newPassword, token);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError((err.body && err.body.error) || 'Falha ao trocar senha');
    } finally {
      setSubmittingPassword(false);
    }
  }

  if (!profile) {
    return (
      <WaDialog title="Meu perfil" onClose={onClose} size="max-w-md">
        <p className="px-6 py-4 text-[14.5px] text-wa-muted">Carregando...</p>
      </WaDialog>
    );
  }

  return (
    <WaDialog title="Meu perfil" onClose={onClose} size="max-w-md">
      <div className="wa-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
        <div className="flex items-center gap-4">
          <AgentAvatar agentId={profile.id} avatarPath={profile.avatarPath} name={profile.name} size={64} />
          <div className="flex flex-col items-start gap-1.5">
            <label className={`${waGhostButtonClass} cursor-pointer`}>
              Alterar foto
              <input
                type="file"
                aria-label="Alterar foto"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarChange}
                disabled={avatarBusy}
                className="hidden"
              />
            </label>
            {profile.avatarPath && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarBusy}
                className="px-2 text-[13px] text-[#b3261e] hover:underline"
              >
                Remover foto
              </button>
            )}
          </div>
        </div>
        {avatarError && <p className={waErrorClass}>{avatarError}</p>}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className={waLabelClass}>
              Nome completo
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={waInputClass}
              required
            />
          </div>
          <div>
            <label htmlFor="profile-phone" className={waLabelClass}>
              Telefone
            </label>
            <input
              id="profile-phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={waInputClass}
            />
          </div>
          <div>
            <label className={waLabelClass}>E-mail</label>
            <p className="text-[14.5px] text-wa-text">{profile.email}</p>
          </div>
          {profileError && <p className={waErrorClass}>{profileError}</p>}
          {profileSuccess && <p className="text-[13.5px] text-wa-muted">Perfil atualizado.</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={savingProfile} className={waPrimaryButtonClass}>
              Salvar
            </button>
          </div>
        </form>

        <div className="border-t border-wa-border pt-4">
          <h3 className="mb-3 text-[15px] font-medium text-wa-text">Trocar senha</h3>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label htmlFor="current-password" className={waLabelClass}>
                Senha atual
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="new-password" className={waLabelClass}>
                Nova senha
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className={waLabelClass}>
                Confirmar nova senha
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={waInputClass}
                required
              />
            </div>
            {passwordError && <p className={waErrorClass}>{passwordError}</p>}
            {passwordSuccess && <p className="text-[13.5px] text-wa-muted">Senha alterada com sucesso.</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={submittingPassword} className={waPrimaryButtonClass}>
                Trocar senha
              </button>
            </div>
          </form>
        </div>
      </div>
      <div className="flex shrink-0 justify-end px-4 py-3">
        <button type="button" onClick={onClose} className={waGhostButtonClass}>
          Fechar
        </button>
      </div>
    </WaDialog>
  );
}

export default ProfileModal;
```

Apagar `frontend/src/components/ChangePasswordModal.jsx` e
`frontend/src/components/ChangePasswordModal.test.jsx` — sua cobertura de troca de
senha já está reproduzida no teste `'changes the password from the embedded section'`
acima.

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/components/ProfileModal.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProfileModal.jsx frontend/src/components/ProfileModal.test.jsx
git rm frontend/src/components/ChangePasswordModal.jsx frontend/src/components/ChangePasswordModal.test.jsx
git commit -m "$(cat <<'EOF'
Add ProfileModal (avatar, name, phone, email, password), replacing ChangePasswordModal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Trocar `ChangePasswordModal` por `ProfileModal` nas 4 páginas

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx`
- Modify: `frontend/src/pages/AttendanceDashboardPage.jsx`
- Modify: `frontend/src/pages/MetricsPage.jsx`
- Modify: `frontend/src/pages/AdminChannelsPage.jsx`
- Test: `frontend/src/pages/DashboardPage.test.jsx` (verificar se precisa de ajuste)

**Interfaces:**
- Consumes: `ProfileModal` (Task 7), `onProfileClick` do `NavRail` (Task 6).
- Produces: as 4 páginas abrem `ProfileModal` no lugar de `ChangePasswordModal`.
  `DashboardPage.jsx` também força o `TeamPanel` a recarregar a lista de colegas
  (via `key`) sempre que o próprio perfil é salvo.

- [ ] **Step 1: Atualizar `DashboardPage.jsx`**

Trocar o import:
```js
import ProfileModal from '../components/ProfileModal';
```
(remove o import de `ChangePasswordModal`).

Trocar o estado (perto de `const [transferringId, setTransferringId] = useState(null);`):
```js
  const [profileOpen, setProfileOpen] = useState(false);
  const [teamPanelKey, setTeamPanelKey] = useState(0);
```
(remove `const [changingPassword, setChangingPassword] = useState(false);`)

Trocar a prop do `NavRail`:
```jsx
        <NavRail
          active="conversas"
          onConversasClick={() => setSelectedId(null)}
          onProfileClick={() => setProfileOpen(true)}
          mobileHidden={Boolean(selectedConversation)}
        />
```

Trocar `<TeamPanel />` por `<TeamPanel key={teamPanelKey} />`.

Trocar a renderização do modal:
```jsx
      {profileOpen && (
        <ProfileModal onClose={() => setProfileOpen(false)} onProfileUpdated={() => setTeamPanelKey((k) => k + 1)} />
      )}
```

- [ ] **Step 2: Atualizar `AttendanceDashboardPage.jsx`, `MetricsPage.jsx` e `AdminChannelsPage.jsx`**

Nas três, o padrão é idêntico entre si (nenhuma tem `TeamPanel`, então não precisam de
`onProfileUpdated`/remount-key):

- Trocar o import de `ChangePasswordModal` por `ProfileModal`.
- Trocar `const [changingPassword, setChangingPassword] = useState(false);` por
  `const [profileOpen, setProfileOpen] = useState(false);`.
- Trocar `onChangePasswordClick={() => setChangingPassword(true)}` por
  `onProfileClick={() => setProfileOpen(true)}` na chamada de `<NavRail .../>`.
- Trocar `{changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}`
  por `{profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}`.

- [ ] **Step 3: Verificar os testes existentes das 4 páginas**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx src/pages/AttendanceDashboardPage.test.jsx src/pages/MetricsPage.test.jsx src/pages/AdminChannelsPage.test.jsx`

Se algum teste falhar por referenciar `ChangePasswordModal`/`onChangePasswordClick`
diretamente (por exemplo, um mock de `ChangePasswordModal` ou uma busca por
`getByLabelText('Trocar senha')`), ajustar esse teste para `ProfileModal`/`Meu perfil`,
mesmo padrão do que foi feito no `NavRail.test.jsx` (Task 6). Se todos já passarem sem
ajuste, ótimo — apenas confirme.

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.jsx src/pages/AttendanceDashboardPage.test.jsx src/pages/MetricsPage.test.jsx src/pages/AdminChannelsPage.test.jsx`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/AttendanceDashboardPage.jsx frontend/src/pages/MetricsPage.jsx frontend/src/pages/AdminChannelsPage.jsx
git commit -m "$(cat <<'EOF'
Wire ProfileModal into every page that used to show ChangePasswordModal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(Se a Task 3 exigiu ajuste em algum arquivo de teste de página, adicione-o ao mesmo
commit.)

---

### Task 9: Foto do colega no Painel de Equipe

**Files:**
- Modify: `frontend/src/components/TeamPanel.jsx`
- Test: `frontend/src/components/TeamPanel.test.jsx`

**Interfaces:**
- Consumes: `AgentAvatar` (Task 5); `avatarPath` agora presente em cada item de
  `useAgents()` (Task 2 já expõe isso via `GET /api/agents`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `frontend/src/components/TeamPanel.test.jsx`:

```js
  test('shows each teammate\'s avatar', () => {
    useAgents.mockReturnValue([
      { id: 'a1', name: 'Ana', avatarPath: 'avatars/a1.jpg' },
      { id: 'a2', name: 'Bruno', avatarPath: null },
    ]);
    usePresence.mockReturnValue(new Set());
    render(<TeamPanel />);

    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('B')).toBeInTheDocument();
  });
```

(precisa de `vi.mock('../contexts/AuthContext')` + `useAuth.mockReturnValue({ token:
'tok-123' })` no `beforeEach` do arquivo, já que `AgentAvatar` depende de
`useAuth()` — adicionar o import e o mock junto aos já existentes no topo do arquivo.)

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd frontend && npx vitest run src/components/TeamPanel.test.jsx`
Expected: FAIL — nenhuma `role="img"` é renderizada hoje.

- [ ] **Step 3: Implementar**

Em `frontend/src/components/TeamPanel.jsx`, importar `AgentAvatar`:

```js
import AgentAvatar from './AgentAvatar';
```

E adicionar o avatar em cada `<li>` (antes do `<span className="truncate">`):

```jsx
                <li key={teammate.id} className="flex items-center gap-2 px-4 py-[5px] text-[13.5px] text-ink-950">
                  <span
                    title={onlineIds.has(teammate.id) ? 'Online' : 'Offline'}
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      onlineIds.has(teammate.id) ? 'bg-teal-signal' : 'bg-ink-950/20'
                    }`}
                  />
                  <AgentAvatar agentId={teammate.id} avatarPath={teammate.avatarPath} name={teammate.name} size={22} />
                  <span className="truncate">{teammate.name}</span>
                </li>
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `cd frontend && npx vitest run src/components/TeamPanel.test.jsx`
Expected: PASS, todos verdes (inclusive os testes já existentes no arquivo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TeamPanel.jsx frontend/src/components/TeamPanel.test.jsx
git commit -m "$(cat <<'EOF'
Show each teammate's avatar in the Team panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification (after all tasks)

Run the full backend and frontend suites clean, in the isolated worktree, before
finishing the branch:

```bash
npm test
cd frontend && npx vitest run
```

Both must be 100% green before proceeding to
`superpowers:finishing-a-development-branch`.

Nenhuma variável de ambiente nova é necessária (diferente do 360dialog/PUBLIC_BASE_URL).
A migração da Task 1 precisa rodar em produção após o deploy (`npm run migrate -- up`
via o Render Shell), mesmo processo já estabelecido para toda migração deste projeto —
não bloqueia o boot (colunas nullable), mas as rotas novas vão 500 até rodar.
