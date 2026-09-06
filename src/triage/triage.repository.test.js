const { getPool, closePool } = require('../db/pool');
const { createSector } = require('../sectors/sector.repository');
const {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
} = require('./triage.repository');

const DEFAULT_QUESTION = 'Para agilizar seu atendimento, escolha uma opção digitando o número correspondente:';
const DEFAULT_CONFIRMATION = 'Obrigado! Você será atendido em breve.';

describe('triage repository', () => {
  let financeiroId;
  let suporteId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE triage_options, sectors CASCADE');
    await getPool().query('UPDATE triage_config SET question_text = $1, confirmation_text = $2, max_attempts = $3 WHERE id = 1', [
      DEFAULT_QUESTION,
      DEFAULT_CONFIRMATION,
      2,
    ]);
    const financeiro = await createSector({ name: 'Financeiro' });
    const suporte = await createSector({ name: 'Suporte' });
    financeiroId = financeiro.id;
    suporteId = suporte.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('getTriageConfig returns the seeded singleton row', async () => {
    const config = await getTriageConfig();
    expect(config).toEqual({ questionText: DEFAULT_QUESTION, confirmationText: DEFAULT_CONFIRMATION, maxAttempts: 2 });
  });

  test('updateTriageConfig overwrites the singleton row and returns it', async () => {
    const updated = await updateTriageConfig({ questionText: 'Nova pergunta', confirmationText: 'Nova confirmação', maxAttempts: 3 });
    expect(updated).toEqual({ questionText: 'Nova pergunta', confirmationText: 'Nova confirmação', maxAttempts: 3 });
    const reread = await getTriageConfig();
    expect(reread).toEqual(updated);
  });

  test('listTriageOptions returns an empty array when none are configured', async () => {
    expect(await listTriageOptions()).toEqual([]);
  });

  test('createTriageOption stores and returns the option with its sector name', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: ['financeiro', 'fatura'] });
    expect(option).toEqual({
      id: expect.any(String),
      optionNumber: 1,
      sectorId: financeiroId,
      sectorName: 'Financeiro',
      keywords: ['financeiro', 'fatura'],
    });
  });

  test('listTriageOptions returns options ordered by option number ascending', async () => {
    await createTriageOption({ optionNumber: 2, sectorId: suporteId, keywords: ['suporte'] });
    await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: ['financeiro'] });

    const options = await listTriageOptions();

    expect(options.map((o) => o.optionNumber)).toEqual([1, 2]);
    expect(options.map((o) => o.sectorName)).toEqual(['Financeiro', 'Suporte']);
  });

  test('createTriageOption rejects a duplicate option number', async () => {
    await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: [] });
    await expect(createTriageOption({ optionNumber: 1, sectorId: suporteId, keywords: [] })).rejects.toMatchObject({
      code: '23505',
    });
  });

  test('updateTriageOption changes the number, sector, and keywords', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: ['financeiro'] });

    const updated = await updateTriageOption(option.id, { optionNumber: 5, sectorId: suporteId, keywords: ['suporte', 'internet'] });

    expect(updated).toEqual({
      id: option.id,
      optionNumber: 5,
      sectorId: suporteId,
      sectorName: 'Suporte',
      keywords: ['suporte', 'internet'],
    });
  });

  test('updateTriageOption returns null when the option does not exist', async () => {
    const updated = await updateTriageOption('00000000-0000-0000-0000-000000000000', {
      optionNumber: 1,
      sectorId: financeiroId,
      keywords: [],
    });
    expect(updated).toBeNull();
  });

  test('deleteTriageOption removes the option and returns true', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: [] });
    expect(await deleteTriageOption(option.id)).toBe(true);
    expect(await listTriageOptions()).toEqual([]);
  });

  test('deleteTriageOption returns false when the option does not exist', async () => {
    expect(await deleteTriageOption('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  test('deleting a sector cascades and removes its triage option', async () => {
    const option = await createTriageOption({ optionNumber: 1, sectorId: financeiroId, keywords: [] });
    await getPool().query('DELETE FROM sectors WHERE id = $1', [financeiroId]);
    expect(await listTriageOptions()).toEqual([]);
    expect(await updateTriageOption(option.id, { optionNumber: 1, sectorId: suporteId, keywords: [] })).toBeNull();
  });
});
