jest.mock('../conversations/contact.repository');
jest.mock('../media/media-storage');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findContactById, updateContact } = require('../conversations/contact.repository');
const { getMediaFilePath } = require('../media/media-storage');
const contactsRoutes = require('./contacts.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contacts', contactsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/contacts/:contactId/avatar', () => {
  let tempFile;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFile = path.join(os.tmpdir(), `dw-avatar-route-test-${Date.now()}.jpg`);
    fs.writeFileSync(tempFile, 'conteudo de imagem falso');
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  test('serves the file when the contact has an avatar', async () => {
    findContactById.mockResolvedValue({ id: 'contact-1', avatarPath: 'whatever.jpg' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/contacts/contact-1/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('conteudo de imagem falso');
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  test('accepts the token via query string', async () => {
    findContactById.mockResolvedValue({ id: 'contact-1', avatarPath: 'whatever.jpg' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp()).get(`/api/contacts/contact-1/avatar?token=${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token in header or query string', async () => {
    const res = await request(buildApp()).get('/api/contacts/contact-1/avatar');
    expect(res.status).toBe(401);
    expect(findContactById).not.toHaveBeenCalled();
  });

  test('returns 404 when the contact does not exist', async () => {
    findContactById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/contacts/does-not-exist/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the contact has no avatar', async () => {
    findContactById.mockResolvedValue({ id: 'contact-2', avatarPath: null });
    const res = await request(buildApp())
      .get('/api/contacts/contact-2/avatar')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/contacts/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates the contact and returns it', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria Editada', cityId: 'city-1' });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria Editada', cityId: 'city-1' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria Editada', cityId: 'city-1' });
    expect(res.body.displayName).toBe('Maria Editada');
  });

  test('trims the display name and treats a missing cityId as null', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria', cityId: null });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: '  Maria  ' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria', cityId: null });
  });

  test('treats a blank display name as null', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: null, cityId: null });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: '   ', cityId: null });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: null, cityId: null });
  });

  test('returns 400 when displayName is not a string', async () => {
    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 12345 });

    expect(res.status).toBe(400);
    expect(updateContact).not.toHaveBeenCalled();
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).patch('/api/contacts/contact-1').send({ displayName: 'Maria' });
    expect(res.status).toBe(401);
    expect(updateContact).not.toHaveBeenCalled();
  });

  test('returns 404 when the contact does not exist', async () => {
    updateContact.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/contacts/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria' });

    expect(res.status).toBe(404);
  });
});
