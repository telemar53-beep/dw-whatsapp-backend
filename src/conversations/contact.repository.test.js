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
});
