jest.mock('../agents/agent.repository');
jest.mock('../realtime/presence');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
  getMediaFilePath: jest.fn(),
}));
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents, findAgentById, updateAgentProfile, setAgentAvatarPath } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');
const { saveMediaFile, getMediaFilePath } = require('../media/media-storage');
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

  test('returns id, name, email, role and online status for every agent', async () => {
    listAgents.mockResolvedValue([
      { id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', avatarPath: null },
      { id: 'agent-2', name: 'Bruno', email: 'bruno@dw.com', role: 'admin', avatarPath: null },
    ]);
    isAgentOnline.mockImplementation((id) => id === 'agent-1');

    const res = await request(buildApp())
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', avatarPath: null, online: true },
      { id: 'agent-2', name: 'Bruno', email: 'bruno@dw.com', role: 'admin', avatarPath: null, online: false },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/agents');
    expect(res.status).toBe(401);
    expect(listAgents).not.toHaveBeenCalled();
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
