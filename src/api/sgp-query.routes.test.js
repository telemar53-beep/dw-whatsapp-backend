jest.mock('../integrations/sgp-client');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../media/media-storage');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  downloadBoletoPdf,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('../integrations/sgp-client');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');
const sgpQueryRoutes = require('./sgp-query.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sgp', sgpQueryRoutes);
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/sgp/clientes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sgp/clientes?cpf=03666811337');
    expect(res.status).toBe(401);
  });

  test('returns 400 when cpf is missing', async () => {
    const res = await request(buildApp())
      .get('/api/sgp/clientes')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(lookupClientByCpf).not.toHaveBeenCalled();
  });

  test('strips non-digit characters from cpf before calling the client', async () => {
    lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
    await request(buildApp())
      .get('/api/sgp/clientes?cpf=036.668.113-37')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(lookupClientByCpf).toHaveBeenCalledWith('03666811337');
  });

  test('returns 200 with the normalized result', async () => {
    lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
  });

  test('returns 400 when SGP is not configured', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpNotConfiguredError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SGP integration is not configured' });
  });

  test('returns 400 when SGP is disabled', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpDisabledError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SGP integration is not enabled' });
  });

  test('returns 404 when the client is not found', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpClientNotFoundError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=00000000000')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Client not found' });
  });

  test('returns 502 when SGP cannot be reached', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to reach SGP' });
  });

  test('forwards an unexpected error to the error middleware', async () => {
    lookupClientByCpf.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/sgp/contratos/:contratoId/boleto', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 200 with the normalized duplicate invoice result', async () => {
    getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' }] });
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(getDuplicateInvoice).toHaveBeenCalledWith('17402');
    expect(res.status).toBe(200);
    expect(res.body.hasOpenInvoice).toBe(true);
  });

  test('returns 502 when SGP cannot be reached', async () => {
    getDuplicateInvoice.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(502);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/sgp/contratos/17402/boleto');
    expect(res.status).toBe(401);
    expect(getDuplicateInvoice).not.toHaveBeenCalled();
  });
});

describe('POST /api/sgp/contratos/:contratoId/boleto-pdf', () => {
  beforeEach(() => jest.clearAllMocks());

  const CONVERSATION = { id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' };

  test('returns 401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .send({ conversationId: 'conv-1', boletoLink: 'https://x/boleto.pdf' });
    expect(res.status).toBe(401);
  });

  test('returns 400 when conversationId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ boletoLink: 'https://x/boleto.pdf' });
    expect(res.status).toBe(400);
    expect(getConversationWithContact).not.toHaveBeenCalled();
  });

  test('returns 400 when boletoLink is missing', async () => {
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ conversationId: 'conv-1' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ conversationId: 'conv-missing', boletoLink: 'https://x/boleto.pdf' });
    expect(res.status).toBe(404);
  });

  test('returns 403 when the caller is not the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue(CONVERSATION);
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .set('Authorization', `Bearer ${tokenFor('agent-2', 'agent')}`)
      .send({ conversationId: 'conv-1', boletoLink: 'https://x/boleto.pdf' });
    expect(res.status).toBe(403);
    expect(downloadBoletoPdf).not.toHaveBeenCalled();
  });

  test('downloads the PDF, saves it, and enqueues it as a document message', async () => {
    getConversationWithContact.mockResolvedValue(CONVERSATION);
    downloadBoletoPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    saveMediaFile.mockResolvedValue('abc123.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1', messageType: 'document', mediaPath: 'abc123.pdf' });

    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ conversationId: 'conv-1', boletoLink: 'https://x/boleto.pdf' });

    expect(downloadBoletoPdf).toHaveBeenCalledWith('https://x/boleto.pdf');
    expect(saveMediaFile).toHaveBeenCalledWith(expect.any(Buffer), '.pdf');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: null,
      messageType: 'document',
      mediaPath: 'abc123.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'boleto.pdf',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'msg-1', messageType: 'document', mediaPath: 'abc123.pdf' });
  });

  test('returns 502 when the PDF download fails', async () => {
    getConversationWithContact.mockResolvedValue(CONVERSATION);
    downloadBoletoPdf.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto-pdf')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ conversationId: 'conv-1', boletoLink: 'https://x/boleto.pdf' });
    expect(res.status).toBe(502);
    expect(saveMediaFile).not.toHaveBeenCalled();
  });
});
