const { getPool, closePool } = require('../db/pool');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');

describe('contact repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE contacts CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('creates a new contact when phone number is not known', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(contact.id).toBeDefined();
    expect(contact.phoneNumber).toBe('+5511988887777');
    expect(contact.displayName).toBe('Maria');
  });

  test('returns the existing contact on a second call with the same phone number', async () => {
    const first = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    const second = await findOrCreateContactByPhoneNumber('+5511988887777', 'Maria');
    expect(second.id).toBe(first.id);
  });

  test('resolves to the same contact when called concurrently for a new phone number', async () => {
    const [first, second] = await Promise.all([
      findOrCreateContactByPhoneNumber('+5511955554444', 'Concurrent Contact'),
      findOrCreateContactByPhoneNumber('+5511955554444', 'Concurrent Contact'),
    ]);
    expect(first.id).toBe(second.id);

    const result = await getPool().query('SELECT count(*) FROM contacts WHERE phone_number = $1', ['+5511955554444']);
    expect(Number(result.rows[0].count)).toBe(1);
  });
});
