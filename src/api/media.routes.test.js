jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findMessageById } = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');
const mediaRoutes = require('./media.routes');

function buildApp() {
  const app = express();
  app.use('/api/media', mediaRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/media/:messageId', () => {
  let tempFile;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFile = path.join(os.tmpdir(), `dw-media-route-test-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'conteudo do arquivo de teste');
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  test('serves the file when the message exists and has media', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', mediaPath: 'whatever.txt' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/media/msg-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('conteudo do arquivo de teste');
  });

  test('accepts the token via query string', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', mediaPath: 'whatever.txt' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp()).get(`/api/media/msg-1?token=${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token in header or query string', async () => {
    const res = await request(buildApp()).get('/api/media/msg-1');
    expect(res.status).toBe(401);
    expect(findMessageById).not.toHaveBeenCalled();
  });

  test('returns 404 when the message does not exist', async () => {
    findMessageById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/media/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the message has no media', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-2', mediaPath: null });
    const res = await request(buildApp())
      .get('/api/media/msg-2')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('sets Content-Type from the stored mime type and Content-Disposition with the real filename for documents', async () => {
    findMessageById.mockResolvedValue({
      id: 'msg-3',
      mediaPath: 'whatever.pdf',
      mediaMimeType: 'application/pdf',
      messageType: 'document',
      mediaFilename: 'comprovante.pdf',
    });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/media/msg-3')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('comprovante.pdf');
  });
});
