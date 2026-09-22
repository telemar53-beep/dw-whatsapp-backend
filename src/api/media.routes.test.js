jest.mock('../conversations/message.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../media/media-storage');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findMessageById } = require('../conversations/message.repository');
const { findConversationStatusById } = require('../conversations/conversation.repository');
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
    // A rota agora confere o status da conversa da mensagem. O default e uma
    // conversa comum; cada teste de silent sobrescreve.
    findConversationStatusById.mockResolvedValue('assigned');
    tempFile = path.join(os.tmpdir(), `dw-media-route-test-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'conteudo do arquivo de teste');
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  test('serves the file when the message exists and has media', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', mediaPath: 'whatever.txt' });
    getMediaFilePath.mockReturnValue(tempFile);

    const res = await request(buildApp())
      .get('/api/media/msg-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('conteudo do arquivo de teste');
  });

  test('accepts the token via query string', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', mediaPath: 'whatever.txt' });
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
    findMessageById.mockResolvedValue({ id: 'msg-2', conversationId: 'conv-1', mediaPath: null });
    const res = await request(buildApp())
      .get('/api/media/msg-2')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('sets Content-Type from the stored mime type and Content-Disposition with the real filename for documents', async () => {
    findMessageById.mockResolvedValue({
      id: 'msg-3',
      conversationId: 'conv-1',
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

describe('midia de conversa silent', () => {
  let tempFile;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFile = path.join(os.tmpdir(), `dw-media-silent-test-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'conteudo do arquivo de teste');
    findMessageById.mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', mediaPath: 'boleto.pdf' });
    getMediaFilePath.mockReturnValue(tempFile);
  });

  afterEach(() => {
    fs.rmSync(tempFile, { force: true });
  });

  function pedir(role) {
    return request(buildApp())
      .get('/api/media/msg-1')
      .set('Authorization', `Bearer ${tokenFor('quem-1', role)}`);
  }

  test('atendente recebe 403 e NENHUM arquivo e servido', async () => {
    findConversationStatusById.mockResolvedValue('silent');

    const res = await pedir('agent');

    expect(res.status).toBe(403);
    // A prova de que o arquivo nao saiu: o caminho nem chegou a ser resolvido.
    expect(getMediaFilePath).not.toHaveBeenCalled();
    expect(res.text).not.toContain('conteudo do arquivo de teste');
  });

  test('administrador continua baixando a midia do disparo', async () => {
    findConversationStatusById.mockResolvedValue('silent');

    const res = await pedir('admin');

    expect(res.status).toBe(200);
    expect(getMediaFilePath).toHaveBeenCalledWith('boleto.pdf');
  });

  test('gerente tambem continua baixando', async () => {
    findConversationStatusById.mockResolvedValue('silent');

    expect((await pedir('manager')).status).toBe(200);
  });

  test('administrador nem consulta o status: a guarda so vale para quem nao e administrativo', async () => {
    findConversationStatusById.mockResolvedValue('silent');

    await pedir('admin');

    expect(findConversationStatusById).not.toHaveBeenCalled();
  });

  test('atendente baixa midia de conversa na fila, sem dono', async () => {
    findConversationStatusById.mockResolvedValue('waiting');

    const res = await pedir('agent');

    expect(res.status).toBe(200);
    expect(getMediaFilePath).toHaveBeenCalledWith('boleto.pdf');
  });

  test('atendente baixa midia de conversa atribuida', async () => {
    findConversationStatusById.mockResolvedValue('assigned');
    expect((await pedir('agent')).status).toBe(200);
  });

  test('atendente baixa midia de conversa encerrada, que e o historico do contato', async () => {
    findConversationStatusById.mockResolvedValue('closed');
    expect((await pedir('agent')).status).toBe(200);
  });

  test('sem token continua 401, e nada e consultado', async () => {
    const res = await request(buildApp()).get('/api/media/msg-1');

    expect(res.status).toBe(401);
    expect(findMessageById).not.toHaveBeenCalled();
    expect(findConversationStatusById).not.toHaveBeenCalled();
  });
});
