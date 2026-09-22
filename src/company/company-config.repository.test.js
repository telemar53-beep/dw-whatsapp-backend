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
    expect(await getCompanyConfig()).toEqual({ id: null, name: '', acceptedPayeeNames: [], logoUrl: '', symbolUrl: '', brandColor: '' });
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

// A marca da instalação vive na mesma linha singleton do nome. Salvar o
// cartão Empresa mandando só nome e nomes do comprovante NÃO pode apagá-la
// (ADR-011) — e é exatamente isso que aconteceria com um UPDATE total.
describe('identidade visual da instalação', () => {
  // Este describe é irmão do de cima, não filho: precisa do seu próprio
  // TRUNCATE, senão a linha singleton sobrevive de um teste para o outro.
  beforeEach(async () => {
    await getPool().query('TRUNCATE company_config');
  });

  afterAll(async () => {
    await closePool();
  });

  test('sai vazia e pode ser gravada', async () => {
    const inicial = await getCompanyConfig();
    expect(inicial.logoUrl).toBe('');
    expect(inicial.symbolUrl).toBe('');
    expect(inicial.brandColor).toBe('');

    const salva = await upsertCompanyConfig({
      name: 'Provedor X',
      acceptedPayeeNames: ['Provedor X Ltda'],
      logoUrl: 'https://cdn.exemplo/logo.png',
      symbolUrl: 'https://cdn.exemplo/simbolo.png',
      brandColor: '#1a73e8',
    });

    expect(salva.logoUrl).toBe('https://cdn.exemplo/logo.png');
    expect(salva.symbolUrl).toBe('https://cdn.exemplo/simbolo.png');
    expect(salva.brandColor).toBe('#1a73e8');
    expect((await getCompanyConfig()).brandColor).toBe('#1a73e8');
  });

  test('salvar só o nome NÃO apaga a marca', async () => {
    await upsertCompanyConfig({
      name: 'Provedor X',
      acceptedPayeeNames: [],
      logoUrl: 'https://cdn.exemplo/logo.png',
      symbolUrl: 'https://cdn.exemplo/simbolo.png',
      brandColor: '#1a73e8',
    });

    const depois = await upsertCompanyConfig({ name: 'Provedor Y', acceptedPayeeNames: ['Y Ltda'] });

    expect(depois.name).toBe('Provedor Y');
    expect(depois.acceptedPayeeNames).toEqual(['Y Ltda']);
    expect(depois.logoUrl).toBe('https://cdn.exemplo/logo.png');
    expect(depois.symbolUrl).toBe('https://cdn.exemplo/simbolo.png');
    expect(depois.brandColor).toBe('#1a73e8');
  });

  // Omitir é "não mexe"; vazio é "tira". Os dois precisam ser distinguíveis,
  // senão não há como remover um logo depois de posto.
  test('string vazia apaga, e só o campo enviado', async () => {
    await upsertCompanyConfig({
      name: 'Provedor X', acceptedPayeeNames: [],
      logoUrl: 'https://cdn.exemplo/logo.png',
      symbolUrl: 'https://cdn.exemplo/simbolo.png',
      brandColor: '#1a73e8',
    });

    const depois = await upsertCompanyConfig({ name: 'Provedor X', acceptedPayeeNames: [], logoUrl: '' });

    expect(depois.logoUrl).toBe('');
    expect(depois.symbolUrl).toBe('https://cdn.exemplo/simbolo.png');
    expect(depois.brandColor).toBe('#1a73e8');
  });

  test('a primeira gravação sem marca nenhuma grava vazio, não null', async () => {
    const criada = await upsertCompanyConfig({ name: 'Provedor X', acceptedPayeeNames: [] });

    expect(criada.logoUrl).toBe('');
    expect(criada.symbolUrl).toBe('');
    expect(criada.brandColor).toBe('');
  });
});
