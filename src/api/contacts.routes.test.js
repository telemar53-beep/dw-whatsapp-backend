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

const CITY_ID = '22222222-2222-4222-8222-222222222222';

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

  // Era o caminho legado da migracao. O JWT de sessao numa URL e uma
  // credencial de 12 horas em texto claro no log do proxy, no historico do
  // navegador e em qualquer print. Agora a URL so aceita ?mediaToken=.
  test('o JWT de sessao na query NAO autentica mais', async () => {
    const res = await request(buildApp()).get(`/api/contacts/contact-1/avatar?token=${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(401);
    expect(findContactById).not.toHaveBeenCalled();
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
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria Editada', cityId: CITY_ID });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria Editada', cityId: CITY_ID });

    expect(res.status).toBe(200);
    // internalNote nao foi enviado, entao nao entra no patch: campo omitido
    // permanece inalterado (ADR-011).
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria Editada', cityId: CITY_ID });
    expect(res.body.displayName).toBe('Maria Editada');
  });

  test('trims the display name and nao toca em cityId quando ele nao vem', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria', cityId: CITY_ID });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: '  Maria  ' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria' });
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

  test('passes the internal note through', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria', cityId: null, internalNote: 'Cliente VIP' });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria', internalNote: '  Cliente VIP  ' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria', internalNote: 'Cliente VIP' });
  });

  test('treats a blank internal note as null', async () => {
    updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria', cityId: null, internalNote: null });

    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria', internalNote: '   ' });

    expect(res.status).toBe(200);
    expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria', internalNote: null });
  });

  test('returns 400 when internalNote is not a string', async () => {
    const res = await request(buildApp())
      .patch('/api/contacts/contact-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ displayName: 'Maria', internalNote: 12345 });

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

  // ADR-011: "campo nao enviado deve permanecer inalterado". Antes, a chave
  // ausente era indistinguivel de null e o UPDATE apagava o valor: quem
  // mandasse so o nome zerava a cidade e a nota interna do contato.
  describe('campo omitido permanece inalterado', () => {
    function patch(body) {
      updateContact.mockResolvedValue({ id: 'contact-1' });
      return request(buildApp())
        .patch('/api/contacts/contact-1')
        .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
        .send(body);
    }

    test('mandar so o nome nao toca em cidade nem em nota interna', async () => {
      await patch({ displayName: 'Maria' });
      expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: 'Maria' });
    });

    test('mandar so a cidade nao toca em nome nem em nota interna', async () => {
      await patch({ cityId: CITY_ID });
      expect(updateContact).toHaveBeenCalledWith('contact-1', { cityId: CITY_ID });
    });

    test('mandar so a nota interna nao toca em nome nem em cidade', async () => {
      await patch({ internalNote: 'Cliente VIP' });
      expect(updateContact).toHaveBeenCalledWith('contact-1', { internalNote: 'Cliente VIP' });
    });

    test('body vazio nao altera campo nenhum', async () => {
      await patch({});
      expect(updateContact).toHaveBeenCalledWith('contact-1', {});
    });

    test('null explicito continua apagando, que e diferente de omitir', async () => {
      await patch({ displayName: null, cityId: null, internalNote: null });
      expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: null, cityId: null, internalNote: null });
    });

    test('string vazia tambem apaga', async () => {
      await patch({ displayName: '', internalNote: '' });
      expect(updateContact).toHaveBeenCalledWith('contact-1', { displayName: null, internalNote: null });
    });
  });

  describe('a resposta nao devolve dado interno que ninguem pediu', () => {
    test('devolve so os campos que a edicao de cliente usa', async () => {
      updateContact.mockResolvedValue({
        id: 'contact-1',
        displayName: 'Maria',
        cityId: CITY_ID,
        internalNote: 'Cliente VIP',
        // Tudo abaixo vem do repositorio e nao pode sair na resposta.
        phoneNumber: '5511999998888',
        avatarPath: 'contatos/abc.jpg',
        avatarCheckedAt: '2026-09-22T10:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        sgpClientId: '4321',
        sgpContractId: '9876',
        sgpDocument: '12345678900',
        sgpFirstName: 'Maria',
      });

      const res = await request(buildApp())
        .patch('/api/contacts/contact-1')
        .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
        .send({ displayName: 'Maria' });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['cityId', 'displayName', 'id', 'internalNote']);
      expect(res.body).toEqual({
        id: 'contact-1',
        displayName: 'Maria',
        cityId: CITY_ID,
        internalNote: 'Cliente VIP',
      });
    });

    test('o documento do SGP nao sai nem para administrador', async () => {
      updateContact.mockResolvedValue({ id: 'contact-1', displayName: 'Maria', sgpDocument: '12345678900' });

      const res = await request(buildApp())
        .patch('/api/contacts/contact-1')
        .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
        .send({ displayName: 'Maria' });

      expect(res.body).not.toHaveProperty('sgpDocument');
      expect(JSON.stringify(res.body)).not.toContain('12345678900');
    });
  });

  describe('cityId invalido', () => {
    test('valor que nao e uuid para em 400, sem chegar ao banco', async () => {
      for (const cityId of ['nao-e-uuid', '123', { a: 1 }, []]) {
        jest.clearAllMocks();
        const res = await request(buildApp())
          .patch('/api/contacts/contact-1')
          .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
          .send({ cityId });

        expect(res.status).toBe(400);
        expect(updateContact).not.toHaveBeenCalled();
      }
    });

    test('uuid valido passa', async () => {
      updateContact.mockResolvedValue({ id: 'contact-1' });

      const res = await request(buildApp())
        .patch('/api/contacts/contact-1')
        .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
        .send({ cityId: CITY_ID });

      expect(res.status).toBe(200);
      expect(updateContact).toHaveBeenCalledWith('contact-1', { cityId: CITY_ID });
    });

    test('null continua limpando a cidade', async () => {
      updateContact.mockResolvedValue({ id: 'contact-1' });

      const res = await request(buildApp())
        .patch('/api/contacts/contact-1')
        .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
        .send({ cityId: null });

      expect(res.status).toBe(200);
      expect(updateContact).toHaveBeenCalledWith('contact-1', { cityId: null });
    });
  });
});
