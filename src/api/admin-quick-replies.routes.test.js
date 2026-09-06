jest.mock('../quick-replies/quick-reply.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} = require('../quick-replies/quick-reply.repository');
const adminQuickRepliesRoutes = require('./admin-quick-replies.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/quick-replies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new quick reply', async () => {
    createQuickReply.mockResolvedValue({
      id: 'qr-1',
      title: 'Boas-vindas',
      content: 'Olá!',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Boas-vindas', content: 'Olá!' });

    expect(res.status).toBe(201);
    expect(createQuickReply).toHaveBeenCalledWith({ title: 'Boas-vindas', content: 'Olá!' });
    expect(res.body.id).toBe('qr-1');
  });

  test('returns 400 when title or content is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Boas-vindas' });

    expect(res.status).toBe(400);
    expect(createQuickReply).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ title: 'Boas-vindas', content: 'Olá!' });

    expect(res.status).toBe(403);
    expect(createQuickReply).not.toHaveBeenCalled();
  });

  test('returns 400 when title is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: '   ', content: 'Olá!' });

    expect(res.status).toBe(400);
    expect(createQuickReply).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before creating', async () => {
    createQuickReply.mockResolvedValue({
      id: 'qr-1',
      title: 'Boas-vindas',
      content: 'Olá!',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/admin/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: '  Boas-vindas  ', content: '  Olá!  ' });

    expect(res.status).toBe(201);
    expect(createQuickReply).toHaveBeenCalledWith({ title: 'Boas-vindas', content: 'Olá!' });
  });
});

describe('PATCH /api/admin/quick-replies/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates an existing quick reply', async () => {
    updateQuickReply.mockResolvedValue({
      id: 'qr-1',
      title: 'Editado',
      content: 'Texto editado',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Editado', content: 'Texto editado' });

    expect(res.status).toBe(200);
    expect(updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Texto editado' });
    expect(res.body.title).toBe('Editado');
  });

  test('returns 400 when title or content is missing', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Editado' });

    expect(res.status).toBe(400);
    expect(updateQuickReply).not.toHaveBeenCalled();
  });

  test('returns 404 when the quick reply does not exist', async () => {
    updateQuickReply.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: 'Editado', content: 'Texto editado' });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ title: 'Editado', content: 'Texto editado' });

    expect(res.status).toBe(403);
    expect(updateQuickReply).not.toHaveBeenCalled();
  });

  test('returns 400 when title is only whitespace', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: '   ', content: 'Texto editado' });

    expect(res.status).toBe(400);
    expect(updateQuickReply).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before updating', async () => {
    updateQuickReply.mockResolvedValue({
      id: 'qr-1',
      title: 'Editado',
      content: 'Texto editado',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .patch('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ title: '  Editado  ', content: '  Texto editado  ' });

    expect(res.status).toBe(200);
    expect(updateQuickReply).toHaveBeenCalledWith('qr-1', { title: 'Editado', content: 'Texto editado' });
  });
});

describe('DELETE /api/admin/quick-replies/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an existing quick reply', async () => {
    deleteQuickReply.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteQuickReply).toHaveBeenCalledWith('qr-1');
  });

  test('returns 404 when the quick reply does not exist', async () => {
    deleteQuickReply.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/quick-replies/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/quick-replies/qr-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteQuickReply).not.toHaveBeenCalled();
  });
});
