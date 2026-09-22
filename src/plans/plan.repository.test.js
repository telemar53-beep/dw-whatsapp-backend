const { getPool, closePool } = require('../db/pool');
const {
  listPlansForAdmin, listarPlanosDisponiveis, createPlan, updatePlan, deletePlan,
} = require('./plan.repository');

describe('plan repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE plans CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createPlan guarda e devolve o plano', async () => {
    const plano = await createPlan({ name: '500 Mega', speedMbps: 500, monthlyPrice: 100, installCondition: 'Gratis' });

    expect(plano.id).toBeDefined();
    expect(plano.name).toBe('500 Mega');
    expect(plano.speedMbps).toBe(500);
    expect(plano.monthlyPrice).toBe(100);
    expect(plano.installCondition).toBe('Gratis');
    expect(plano.active).toBe(true);
    expect(plano.sortOrder).toBe(0);
    expect(plano.note).toBe('');
    expect(plano.createdAt).toBeDefined();
  });

  test('monthlyPrice volta como numero, nao string', async () => {
    const plano = await createPlan({ name: 'Teste', monthlyPrice: 99.9 });

    expect(typeof plano.monthlyPrice).toBe('number');
    expect(plano.monthlyPrice).toBe(99.9);
  });

  test('a lista operacional traz so os ativos e NAO traz note', async () => {
    await createPlan({ name: 'Ativo', monthlyPrice: 100, note: 'segredo' });
    await createPlan({ name: 'Inativo', monthlyPrice: 130, active: false });

    const planos = await listarPlanosDisponiveis();

    expect(planos.map((p) => p.name)).toEqual(['Ativo']);
    expect(planos[0]).not.toHaveProperty('note');
    expect(Object.keys(planos[0]).sort()).toEqual(
      ['id', 'installCondition', 'monthlyPrice', 'name', 'speedMbps'].sort()
    );
  });

  test('a lista administrativa traz inativos e traz note', async () => {
    await createPlan({ name: 'Inativo', monthlyPrice: 130, active: false, note: 'margem baixa' });

    const planos = await listPlansForAdmin();

    expect(planos).toHaveLength(1);
    expect(planos[0].active).toBe(false);
    expect(planos[0].note).toBe('margem baixa');
  });

  test('ordena por sortOrder e depois por nome', async () => {
    await createPlan({ name: 'C', monthlyPrice: 10, sortOrder: 2 });
    await createPlan({ name: 'A', monthlyPrice: 10, sortOrder: 1 });
    await createPlan({ name: 'B', monthlyPrice: 10, sortOrder: 1 });

    expect((await listarPlanosDisponiveis()).map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect((await listPlansForAdmin()).map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });

  test('updatePlan nao mexe em chave ausente', async () => {
    const plano = await createPlan({ name: 'Original', monthlyPrice: 100, note: 'fica', active: true });

    const atualizado = await updatePlan(plano.id, { name: 'Renomeado' });

    expect(atualizado.name).toBe('Renomeado');
    expect(atualizado.note).toBe('fica');
    expect(atualizado.active).toBe(true);
    expect(atualizado.monthlyPrice).toBe(100);
  });

  test('updatePlan aceita valor falso, zero e vazio de proposito', async () => {
    const plano = await createPlan({
      name: 'Ativo', monthlyPrice: 100, speedMbps: 500, note: 'sai', active: true, sortOrder: 5,
    });

    const atualizado = await updatePlan(plano.id, {
      active: false, note: '', speedMbps: null, sortOrder: 0, monthlyPrice: 0,
    });

    expect(atualizado.active).toBe(false);
    expect(atualizado.note).toBe('');
    expect(atualizado.speedMbps).toBeNull();
    expect(atualizado.sortOrder).toBe(0);
    expect(atualizado.monthlyPrice).toBe(0);
  });

  test('updatePlan sem nenhum campo devolve o plano intacto', async () => {
    const plano = await createPlan({ name: 'Intacto', monthlyPrice: 100 });

    const atualizado = await updatePlan(plano.id, {});

    expect(atualizado.name).toBe('Intacto');
    expect(atualizado.monthlyPrice).toBe(100);
  });

  test('updatePlan devolve null quando o id nao existe', async () => {
    expect(await updatePlan('00000000-0000-0000-0000-000000000000', { name: 'x' })).toBeNull();
    expect(await updatePlan('00000000-0000-0000-0000-000000000000', {})).toBeNull();
  });

  test('deletePlan remove e devolve true, ou false quando nao existe', async () => {
    const plano = await createPlan({ name: 'Sai', monthlyPrice: 10 });

    expect(await deletePlan(plano.id)).toBe(true);
    expect(await deletePlan(plano.id)).toBe(false);
    expect(await listPlansForAdmin()).toEqual([]);
  });
});
