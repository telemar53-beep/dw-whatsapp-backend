jest.mock('../cities/city.repository');
jest.mock('../cities/place-dependencies');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createPlace, updatePlace, deleteCity, findCityById } = require('../cities/city.repository');
const { dependenciasDoLugar } = require('../cities/place-dependencies');
const adminCitiesRoutes = require('./admin-cities.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cities', adminCitiesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/cities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new city', async () => {
    createPlace.mockResolvedValue({ id: 'city-1', name: 'Bahia', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Bahia' });

    expect(res.status).toBe(201);
    expect(createPlace).toHaveBeenCalledWith({ name: 'Bahia', kind: 'city', parentId: null, sgpPop: null, active: true, served: false, note: '' });
    expect(res.body.id).toBe('city-1');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(createPlace).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(createPlace).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before creating', async () => {
    createPlace.mockResolvedValue({ id: 'city-1', name: 'Bahia', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '  Bahia  ' });

    expect(res.status).toBe(201);
    expect(createPlace).toHaveBeenCalledWith({ name: 'Bahia', kind: 'city', parentId: null, sgpPop: null, active: true, served: false, note: '' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Bahia' });

    expect(res.status).toBe(403);
    expect(createPlace).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/cities/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A rota passou a conferir dependencias antes de apagar, para municipio com
    // localidade filha virar 409 em vez de 500 de chave estrangeira. Estes
    // casos sao de cidade sem nada pendurado.
    dependenciasDoLugar.mockResolvedValue({
      contatosComoMunicipio: 0, contatosComoLocalidade: 0, filhas: 0, avisos: 0,
    });
  });

  test('deletes an existing city', async () => {
    deleteCity.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteCity).toHaveBeenCalledWith('city-1');
  });

  test('returns 404 when the city does not exist', async () => {
    deleteCity.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/cities/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteCity).not.toHaveBeenCalled();
  });
});

const SEM_DEPENDENCIA = { contatosComoMunicipio: 0, contatosComoLocalidade: 0, filhas: 0, avisos: 0 };
const ADMIN = () => `Bearer ${tokenFor('admin-1', 'admin')}`;
const MUNICIPIO = { id: 'm1', name: 'Municipio', kind: 'city', parentId: null };

describe('POST /api/admin/cities — lugares', () => {
  beforeEach(() => jest.clearAllMocks());

  test('recusa kind unclassified: e valor de migracao, nao opcao de cadastro', async () => {
    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: 'Nao pode', kind: 'unclassified' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('kind is invalid');
    expect(createPlace).not.toHaveBeenCalled();
  });

  test('recusa locality sem parentId', async () => {
    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: 'Sem pai', kind: 'locality' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('parentId is required for locality');
  });

  test('recusa city com parentId', async () => {
    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: 'Errado', kind: 'city', parentId: 'm1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('city cannot have parentId');
  });

  test('recusa localidade filha de outra localidade', async () => {
    findCityById.mockResolvedValue({ id: 'p1', name: 'Povoado', kind: 'locality', parentId: 'm1' });

    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: 'Neta', kind: 'locality', parentId: 'p1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('parentId must be a city');
  });

  test('recusa pai inexistente', async () => {
    findCityById.mockResolvedValue(null);

    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: 'Orfa', kind: 'locality', parentId: 'sumiu' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('parentId not found');
  });

  test('cria localidade com pai valido', async () => {
    findCityById.mockResolvedValue(MUNICIPIO);
    createPlace.mockResolvedValue({ id: 'p1', name: 'Povoado' });

    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: ' Povoado ', kind: 'locality', parentId: 'm1', sgpPop: 'Barao', served: true });

    expect(res.status).toBe(201);
    expect(createPlace).toHaveBeenCalledWith({
      name: 'Povoado', kind: 'locality', parentId: 'm1', sgpPop: 'Barao', active: true, served: true, note: '',
    });
  });

  test('POP ja usado por outro lugar vira 409, nao 500', async () => {
    const conflito = Object.assign(new Error('dup'), { code: '23505', constraint: 'cities_sgp_pop_key_unico' });
    createPlace.mockRejectedValue(conflito);

    const res = await request(buildApp()).post('/api/admin/cities').set('Authorization', ADMIN())
      .send({ name: 'Segundo', kind: 'city', sgpPop: ' BARAO ' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sgpPop already in use');
  });
});

describe('PATCH /api/admin/cities/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renomeia sem tocar no resto', async () => {
    findCityById.mockResolvedValue(MUNICIPIO);
    updatePlace.mockResolvedValue({ ...MUNICIPIO, name: 'Novo' });

    const res = await request(buildApp()).patch('/api/admin/cities/m1').set('Authorization', ADMIN())
      .send({ name: ' Novo ' });

    expect(res.status).toBe(200);
    expect(updatePlace).toHaveBeenCalledWith('m1', { name: 'Novo' });
  });

  test('marcar como atendida e alteracao comum, sem consultar dependencias', async () => {
    findCityById.mockResolvedValue(MUNICIPIO);
    updatePlace.mockResolvedValue({ ...MUNICIPIO, served: true });

    const res = await request(buildApp()).patch('/api/admin/cities/m1').set('Authorization', ADMIN())
      .send({ served: true, active: false, note: '' });

    expect(res.status).toBe(200);
    expect(updatePlace).toHaveBeenCalledWith('m1', { served: true, active: false, note: '' });
    expect(dependenciasDoLugar).not.toHaveBeenCalled();
  });

  test('id inexistente devolve 404', async () => {
    findCityById.mockResolvedValue(null);

    const res = await request(buildApp()).patch('/api/admin/cities/sumiu').set('Authorization', ADMIN())
      .send({ name: 'x' });

    expect(res.status).toBe(404);
  });

  test('trocar o pai com contatos vinculados devolve 409 nomeando o que impede', async () => {
    findCityById.mockImplementation(async (id) =>
      (id === 'p1' ? { id: 'p1', name: 'Povoado', kind: 'locality', parentId: 'm1' } : MUNICIPIO));
    dependenciasDoLugar.mockResolvedValue({ ...SEM_DEPENDENCIA, contatosComoLocalidade: 24 });

    const res = await request(buildApp()).patch('/api/admin/cities/p1').set('Authorization', ADMIN())
      .send({ parentId: 'm2' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('structural change blocked');
    expect(res.body.dependencies.contatosComoLocalidade).toBe(24);
    expect(updatePlace).not.toHaveBeenCalled();
  });

  test('virar localidade com contatos como municipio devolve 409', async () => {
    findCityById.mockImplementation(async (id) =>
      (id === 'c1' ? { id: 'c1', name: 'Cidade', kind: 'city', parentId: null } : MUNICIPIO));
    dependenciasDoLugar.mockResolvedValue({ ...SEM_DEPENDENCIA, contatosComoMunicipio: 32 });

    const res = await request(buildApp()).patch('/api/admin/cities/c1').set('Authorization', ADMIN())
      .send({ kind: 'locality', parentId: 'm1' });

    expect(res.status).toBe(409);
    expect(res.body.dependencies.contatosComoMunicipio).toBe(32);
  });

  test('mudanca estrutural com localidades filhas devolve 409', async () => {
    findCityById.mockImplementation(async (id) =>
      (id === 'c1' ? { id: 'c1', name: 'Cidade', kind: 'city', parentId: null } : MUNICIPIO));
    dependenciasDoLugar.mockResolvedValue({ ...SEM_DEPENDENCIA, filhas: 2 });

    const res = await request(buildApp()).patch('/api/admin/cities/c1').set('Authorization', ADMIN())
      .send({ kind: 'locality', parentId: 'm1' });

    expect(res.status).toBe(409);
    expect(res.body.dependencies.filhas).toBe(2);
  });

  test('mudanca estrutural passa quando nada depende do registro', async () => {
    findCityById.mockImplementation(async (id) =>
      (id === 'solto' ? { id: 'solto', name: 'Solto', kind: 'city', parentId: null } : MUNICIPIO));
    dependenciasDoLugar.mockResolvedValue(SEM_DEPENDENCIA);
    updatePlace.mockResolvedValue({ id: 'solto', kind: 'locality', parentId: 'm1' });

    const res = await request(buildApp()).patch('/api/admin/cities/solto').set('Authorization', ADMIN())
      .send({ kind: 'locality', parentId: 'm1' });

    expect(res.status).toBe(200);
    expect(updatePlace).toHaveBeenCalledWith('solto', { kind: 'locality', parentId: 'm1' });
  });

  test('um registro legado pode ser classificado como municipio mesmo com contatos', async () => {
    findCityById.mockResolvedValue({ id: 'l1', name: 'Aurizona', kind: 'unclassified', parentId: null });
    dependenciasDoLugar.mockResolvedValue({ ...SEM_DEPENDENCIA, contatosComoMunicipio: 10 });
    updatePlace.mockResolvedValue({ id: 'l1', kind: 'city' });

    const res = await request(buildApp()).patch('/api/admin/cities/l1').set('Authorization', ADMIN())
      .send({ kind: 'city' });

    expect(res.status).toBe(200);
    expect(updatePlace).toHaveBeenCalledWith('l1', { kind: 'city', parentId: null });
  });

  test('atendente comum nao edita', async () => {
    const res = await request(buildApp()).patch('/api/admin/cities/m1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`).send({ name: 'x' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/cities/:id — com filhas', () => {
  beforeEach(() => jest.clearAllMocks());

  test('municipio com localidade filha devolve 409, nao 500 de chave estrangeira', async () => {
    dependenciasDoLugar.mockResolvedValue({ ...SEM_DEPENDENCIA, filhas: 1 });

    const res = await request(buildApp()).delete('/api/admin/cities/m1').set('Authorization', ADMIN());

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('place has localities');
    expect(res.body.dependencies.filhas).toBe(1);
    expect(deleteCity).not.toHaveBeenCalled();
  });
});
