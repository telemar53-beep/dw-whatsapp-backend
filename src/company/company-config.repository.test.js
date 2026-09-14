const { getPool, closePool } = require('../db/pool');
const { getCompanyConfig, upsertCompanyConfig } = require('./company-config.repository');

describe('company config repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE company_config');
  });

  afterAll(async () => {
    await closePool();
  });

  test('getCompanyConfig devolve o vazio padrão quando nada foi configurado', async () => {
    expect(await getCompanyConfig()).toEqual({ id: null, name: '', acceptedPayeeNames: [] });
  });

  test('upsertCompanyConfig cria a linha no primeiro salvamento', async () => {
    const config = await upsertCompanyConfig({ name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano de Tal'] });

    expect(config.id).not.toBeNull();
    expect(config.name).toBe('Provedor X');
    expect(config.acceptedPayeeNames).toEqual(['Provedor X Ltda', 'Fulano de Tal']);

    const fetched = await getCompanyConfig();
    expect(fetched.id).toBe(config.id);
    expect(fetched.acceptedPayeeNames).toEqual(['Provedor X Ltda', 'Fulano de Tal']);
  });

  test('upsertCompanyConfig atualiza a linha existente em vez de criar uma segunda', async () => {
    await upsertCompanyConfig({ name: 'Primeiro', acceptedPayeeNames: ['A'] });
    const updated = await upsertCompanyConfig({ name: 'Segundo', acceptedPayeeNames: ['B', 'C'] });

    expect(updated.name).toBe('Segundo');
    expect(updated.acceptedPayeeNames).toEqual(['B', 'C']);

    const all = await getPool().query('SELECT id FROM company_config');
    expect(all.rowCount).toBe(1);
  });

  test('os nomes são guardados separados por ponto e vírgula, sem espaços sobrando nem vazios', async () => {
    const config = await upsertCompanyConfig({ name: '  Provedor X  ', acceptedPayeeNames: ['  Provedor X Ltda ', '', '   ', 'Fulano'] });
    expect(config.name).toBe('Provedor X');
    expect(config.acceptedPayeeNames).toEqual(['Provedor X Ltda', 'Fulano']);

    const row = await getPool().query('SELECT accepted_payee_names FROM company_config');
    expect(row.rows[0].accepted_payee_names).toBe('Provedor X Ltda;Fulano');
  });

  test('lista de nomes ausente ou vazia vira array vazio', async () => {
    const config = await upsertCompanyConfig({ name: 'Provedor X' });
    expect(config.acceptedPayeeNames).toEqual([]);
    expect(await getCompanyConfig()).toMatchObject({ name: 'Provedor X', acceptedPayeeNames: [] });
  });
});
