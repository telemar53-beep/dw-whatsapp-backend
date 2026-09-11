const { getPool, closePool } = require('../db/pool');
const { getBusinessHoursConfig, upsertBusinessHoursConfig } = require('./business-hours.repository');

describe('business hours repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE business_hours_config');
  });

  afterAll(async () => {
    await closePool();
  });

  test('getBusinessHoursConfig returns the empty default when nothing is configured', async () => {
    expect(await getBusinessHoursConfig()).toEqual({
      id: null,
      enabled: false,
      startTime: '08:00',
      endTime: '18:00',
      message: '',
    });
  });

  test('upsertBusinessHoursConfig creates the row on first save', async () => {
    const config = await upsertBusinessHoursConfig({
      enabled: true,
      startTime: '09:00',
      endTime: '17:30',
      message: 'Nosso horário de atendimento é seg-sex das 09:00 às 17:30.',
    });

    expect(config.id).not.toBeNull();
    expect(config.enabled).toBe(true);
    expect(config.startTime).toBe('09:00');
    expect(config.endTime).toBe('17:30');
    expect(config.message).toBe('Nosso horário de atendimento é seg-sex das 09:00 às 17:30.');

    const fetched = await getBusinessHoursConfig();
    expect(fetched.id).toBe(config.id);
    expect(fetched.startTime).toBe('09:00');
  });

  test('upsertBusinessHoursConfig updates the existing row instead of creating a second one', async () => {
    await upsertBusinessHoursConfig({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'primeira' });
    const updated = await upsertBusinessHoursConfig({ enabled: false, startTime: '10:00', endTime: '16:00', message: 'segunda' });

    expect(updated.enabled).toBe(false);
    expect(updated.startTime).toBe('10:00');
    expect(updated.message).toBe('segunda');

    const all = await getPool().query('SELECT id FROM business_hours_config');
    expect(all.rowCount).toBe(1);
  });
});
