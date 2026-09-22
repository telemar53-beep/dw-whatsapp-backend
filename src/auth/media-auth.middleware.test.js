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
const { signMediaToken } = require('./media-token.service');
const { requireAuth } = require('./auth.middleware');
const mediaRoutes = require('../api/media.routes');

function buildApp() {
  const app = express();
  app.use('/api/media', mediaRoutes);
  // Uma rota "normal" qualquer, para provar que o token de mídia não passa nela.
  app.get('/api/normal', requireAuth, (req, res) => res.json({ ok: true }));
  return app;
}

function sessao(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

describe('autenticação de leitura de mídia', () => {
  let tempFile;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFile = path.join(os.tmpdir(), `dw-media-token-test-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'conteudo');
    findMessageById.mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', mediaPath: 'x.txt' });
    findConversationStatusById.mockResolvedValue('assigned');
    getMediaFilePath.mockReturnValue(tempFile);
  });

  afterEach(() => fs.rmSync(tempFile, { force: true }));

  function pedir(query) {
    return request(buildApp()).get(`/api/media/msg-1${query}`);
  }

  test('token de mídia válido é aceito pela rota de mídia', async () => {
    const res = await pedir(`?mediaToken=${signMediaToken({ agentId: 'agent-1' })}`);
    expect(res.status).toBe(200);
  });

  test('token de mídia expirado é recusado', async () => {
    const vencido = jwt.sign({ typ: 'media', sil: false }, process.env.MEDIA_TOKEN_SECRET, { subject: 'a1', expiresIn: -10 });
    const res = await pedir(`?mediaToken=${vencido}`);
    expect(res.status).toBe(401);
    expect(getMediaFilePath).not.toHaveBeenCalled();
  });

  test('o JWT de sessão NÃO vale como mediaToken', async () => {
    const res = await pedir(`?mediaToken=${sessao('agent-1', 'admin')}`);
    expect(res.status).toBe(401);
    expect(getMediaFilePath).not.toHaveBeenCalled();
  });

  test('o token de mídia NÃO passa em requireAuth', async () => {
    const deMidia = signMediaToken({ agentId: 'agent-1', podeVerSilent: true });

    const res = await request(buildApp()).get('/api/normal').set('Authorization', `Bearer ${deMidia}`);

    expect(res.status).toBe(401);
  });

  test('o token de mídia também não passa pelo caminho legado ?token=', async () => {
    const res = await pedir(`?token=${signMediaToken({ agentId: 'agent-1' })}`);
    expect(res.status).toBe(401);
  });

  describe('compatibilidade: o caminho legado continua valendo nesta etapa', () => {
    test('header Authorization com o JWT de sessão continua servindo mídia', async () => {
      const res = await request(buildApp())
        .get('/api/media/msg-1')
        .set('Authorization', `Bearer ${sessao('agent-1', 'agent')}`);
      expect(res.status).toBe(200);
    });

    test('?token= com o JWT de sessão continua servindo mídia', async () => {
      const res = await pedir(`?token=${sessao('agent-1', 'agent')}`);
      expect(res.status).toBe(200);
    });

    test('sem credencial nenhuma, 401', async () => {
      const res = await pedir('');
      expect(res.status).toBe(401);
      expect(findMessageById).not.toHaveBeenCalled();
    });
  });

  describe('conversa silenciada: o token de mídia não reabre o vazamento', () => {
    beforeEach(() => findConversationStatusById.mockResolvedValue('silent'));

    test('atendente com token de mídia continua barrado', async () => {
      const res = await pedir(`?mediaToken=${signMediaToken({ agentId: 'agent-1', podeVerSilent: false })}`);

      expect(res.status).toBe(403);
      expect(getMediaFilePath).not.toHaveBeenCalled();
    });

    test('quem é administrativo mantém o acesso que já tinha', async () => {
      const res = await pedir(`?mediaToken=${signMediaToken({ agentId: 'admin-1', podeVerSilent: true })}`);
      expect(res.status).toBe(200);
    });

    test('o atendente não consegue forjar a permissão trocando o token', async () => {
      // Um token de atendente continua sendo de atendente: a permissão está
      // assinada, não vem da URL nem de um parâmetro.
      const deAtendente = signMediaToken({ agentId: 'agent-1', podeVerSilent: false });
      const res = await pedir(`?mediaToken=${deAtendente}&podeVerSilent=true&sil=true`);
      expect(res.status).toBe(403);
    });

    test('pelo caminho legado a regra também continua: atendente barrado, admin não', async () => {
      expect((await pedir(`?token=${sessao('agent-1', 'agent')}`)).status).toBe(403);
      expect((await pedir(`?token=${sessao('admin-1', 'admin')}`)).status).toBe(200);
      expect((await pedir(`?token=${sessao('manager-1', 'manager')}`)).status).toBe(200);
    });
  });
});
